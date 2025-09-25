import os
import requests
import datetime
import pytz
from flask import Flask, jsonify, send_from_directory
from dotenv import load_dotenv
from flask_caching import Cache

# --- App and Cache Configuration ---
load_dotenv()
config = {"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 900} # Cache for 15 mins
app = Flask(__name__, static_folder='static', static_url_path='')
app.config.from_mapping(config)
cache = Cache(app)

# --- Constants ---
AERO_API_URL = "https://aeroapi.flightaware.com/aeroapi"
AERO_API_KEY = os.getenv("AERO_API_KEY")
AIRPORT_CODE = "KASG"

# --- Helper Functions ---
def is_airport_open():
    tz = pytz.timezone('America/Chicago')
    now = datetime.datetime.now(tz)
    weekday, hour = now.weekday(), now.hour
    return (6 <= hour < 21) if 0 <= weekday <= 4 else (7 <= hour < 19)

@cache.memoize(timeout=600) # Cache API calls for 10 minutes
def fetch_flightaware_data():
    headers = {"x-apikey": AERO_API_KEY}
    tz = pytz.timezone('America/Chicago')
    now_local = datetime.datetime.now(tz)
    
    departures_list = []
    processed_idents = set()

    # --- DEPARTURES ---
    # STEP 1: Get ACTIVE flights first.
    try:
        flights_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights"
        resp = requests.get(flights_url, headers=headers, params={"max_pages": 2}, timeout=15)
        resp.raise_for_status()
        active_data = resp.json()

        for f in active_data.get("departures", []):
            status = (f.get("status") or "").lower()
            
            if "arrived" not in status and "landed" not in status and "estimated" not in status:
                flight_ident = f.get("ident")
                if flight_ident:
                    time_val = (
                        f.get("actual_out") or f.get("estimated_out") or f.get("scheduled_out") or
                        f.get("actual_off") or f.get("estimated_off") or f.get("scheduled_off")
                    )
                    if not time_val: continue

                    try:
                        flight_dt_utc = datetime.datetime.fromisoformat(time_val.replace('Z', '+00:00'))
                        flight_dt_local = flight_dt_utc.astimezone(tz)

                        # *** FINAL TWEAK: Ensure the flight is for today's calendar date ***
                        if flight_dt_local.date() == now_local.date():
                            departures_list.append({
                                "ident": flight_ident,
                                "destination": (f.get("destination") or {}).get("code_icao", "N/A"),
                                "aircraft_type": f.get("aircraft_type", "N/A"),
                                "status": f.get("status", "En Route"),
                                "time": time_val
                            })
                            processed_idents.add(flight_ident)
                    except (ValueError, TypeError):
                        continue
    except requests.exceptions.RequestException as e:
        print(f"Error fetching active flights: {e}")

    # STEP 2: Get SCHEDULED flights and add any that we missed.
    try:
        scheduled_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights/scheduled_departures"
        resp = requests.get(scheduled_url, headers=headers, params={"max_pages": 2}, timeout=15)
        resp.raise_for_status()
        scheduled_data = resp.json()

        for f in scheduled_data.get("scheduled_departures", []):
            flight_ident = f.get("ident")
            if flight_ident and flight_ident not in processed_idents:
                time_val = f.get("scheduled_off")
                if not time_val: continue
                
                try:
                    flight_dt_utc = datetime.datetime.fromisoformat(time_val.replace('Z', '+00:00'))
                    flight_dt_local = flight_dt_utc.astimezone(tz)

                    # *** FINAL TWEAK: Ensure the flight is for today's calendar date ***
                    if flight_dt_local.date() == now_local.date():
                        departures_list.append({
                            "ident": flight_ident,
                            "destination": (f.get("destination") or {}).get("code_icao", "N/A"),
                            "aircraft_type": f.get("aircraft_type", "N/A"),
                            "status": "Planned",
                            "time": time_val
                        })
                except (ValueError, TypeError):
                    continue
    except requests.exceptions.RequestException as e:
        print(f"Error fetching scheduled departures: {e}")

    # --- ARRIVALS ---
    arrivals_list = []
    try:
        arrivals_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights/scheduled_arrivals"
        resp = requests.get(arrivals_url, headers=headers, params={"max_pages": 2}, timeout=15)
        resp.raise_for_status()
        arrival_data = resp.json()
        for f in arrival_data.get("scheduled_arrivals", []):
            flight_time_str = f.get("scheduled_on")
            if flight_time_str:
                try:
                    flight_dt_utc = datetime.datetime.fromisoformat(flight_time_str.replace('Z', '+00:00'))
                    flight_dt_local = flight_dt_utc.astimezone(tz)
                    
                    # *** FINAL TWEAK: Ensure the flight is for today and in the future ***
                    if flight_dt_local.date() == now_local.date() and flight_dt_local >= now_local:
                         arrivals_list.append({
                            "ident": f.get("ident"),
                            "origin": (f.get("origin") or {}).get("code_icao", "N/A"),
                            "aircraft_type": f.get("aircraft_type", "N/A"),
                            "status": "Planned",
                            "time": flight_time_str
                        })
                except (ValueError, TypeError):
                    continue
    except requests.exceptions.RequestException as e:
        print(f"Error fetching scheduled arrivals: {e}")
    
    return {
        "departures": departures_list,
        "scheduled_arrivals": arrivals_list
    }

# --- Routes (No changes below this line) ---
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/flights')
def get_flights():
    if not is_airport_open():
        cache.clear()
        return jsonify({"message": "AIRPORT IS CURRENTLY CLOSED"})
    try:
        data = fetch_flightaware_data()
        return jsonify(data)
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"API request failed: {e}"}), 500

@app.route('/api/weather')
@cache.memoize(timeout=600)
def get_weather():
    if not is_airport_open():
        return jsonify({"error": "Airport is closed"}), 400
    try:
        lat, lon = 36.1747, -94.1231
        nws_headers = {'User-Agent': '(My Weather App, myemail@example.com)'}
        points_url = f"https://api.weather.gov/points/{lat},{lon}"
        points_resp = requests.get(points_url, headers=nws_headers, timeout=10)
        points_resp.raise_for_status()
        observation_stations_url = points_resp.json()["properties"]["observationStations"]
        stations_resp = requests.get(observation_stations_url, headers=nws_headers, timeout=10)
        stations_resp.raise_for_status()
        closest_station_id = stations_resp.json()["features"][0]["properties"]["stationIdentifier"]
        latest_obs_url = f"https://api.weather.gov/stations/{closest_station_id}/observations/latest"
        final_weather_resp = requests.get(latest_obs_url, headers=nws_headers, timeout=10)
        final_weather_resp.raise_for_status()
        data = final_weather_resp.json()["properties"]
        return jsonify(data)
    except requests.exceptions.RequestException:
        return jsonify({"error": "Failed to fetch weather"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
