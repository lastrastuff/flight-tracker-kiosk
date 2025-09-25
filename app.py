import os
import requests
import datetime
import pytz
from flask import Flask, jsonify, send_from_directory
from dotenv import load_dotenv
from flask_caching import Cache

# --- App and Cache Configuration ---
load_dotenv()
config = {"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 1800}
app = Flask(__name__, static_folder='static', static_url_path='')
app.config.from_mapping(config)
cache = Cache(app)

# --- Constants ---
AERO_API_URL = "https://aeroapi.flightaware.com/aeroapi"
AERO_API_KEY = os.getenv("AERO_API_KEY")
AIRPORT_CODE = "KASG"
AIRPORT_LAT = 36.17473947369698
AIRPORT_LON = -94.12315969007389

# --- Helper Functions ---
def is_airport_open():
    tz = pytz.timezone('America/Chicago')
    now = datetime.datetime.now(tz)
    weekday, hour = now.weekday(), now.hour
    return (6 <= hour < 21) if 0 <= weekday <= 4 else (7 <= hour < 19)

def filter_duplicate_flights(flights):
    """Filters out flights for the same aircraft that are less than 20 minutes apart."""
    if not flights:
        return []

    def parse_time(t_str):
        if not t_str:
            return None
        if t_str.endswith('Z'):
            t_str = t_str[:-1] + '+00:00'
        try:
            return datetime.datetime.fromisoformat(t_str)
        except (ValueError, TypeError):
            return None

    for flight in flights:
        flight['parsed_time'] = parse_time(flight.get('time'))

    flights_with_time = [f for f in flights if f['parsed_time']]
    sorted_flights = sorted(
        flights_with_time,
        key=lambda x: (x.get('ident', ''), x['parsed_time']),
        reverse=True
    )

    if not sorted_flights:
        return []

    final_flights = []
    last_flight_kept = None
    for flight in sorted_flights:
        if last_flight_kept is None or flight.get('ident') != last_flight_kept.get('ident'):
            final_flights.append(flight)
            last_flight_kept = flight
            continue

        time_diff = last_flight_kept['parsed_time'] - flight['parsed_time']
        if time_diff >= datetime.timedelta(minutes=20):
            final_flights.append(flight)
            last_flight_kept = flight

    for flight in final_flights:
        del flight['parsed_time']

    final_flights.sort(key=lambda x: parse_time(x.get('time')), reverse=True)
    return final_flights

@cache.memoize(timeout=1800)
def fetch_flightaware_data():
    headers = {"x-apikey": AERO_API_KEY}
    
    tz = pytz.timezone('America/Chicago')
    now_local = datetime.datetime.now(tz)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    all_departures = []
    all_scheduled_arrivals = []
    data = {}
    
    # 1. Get current/recent departures from the main flights endpoint
    params = {"max_pages": 2}
    flights_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights"
    try:
        resp = requests.get(flights_url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        current_departures = data.get("departures", [])
        
        for f in current_departures:
            if not f: continue
            flight_time_str = f.get("actual_off") or f.get("estimated_off") or f.get("scheduled_off")
            if not flight_time_str: continue
            try:
                time_str_for_parsing = flight_time_str.replace('Z', '+00:00')
                flight_dt_utc = datetime.datetime.fromisoformat(time_str_for_parsing)
                flight_dt_local = flight_dt_utc.astimezone(tz)
                status = f.get("status", "").lower()

                if flight_dt_local.date() == now_local.date() and status not in ["arrived", "landed"]:
                    all_departures.append({
                        "ident": f.get("ident"),
                        "destination": (f.get("destination") or {}).get("code_icao", "N/A"),
                        "aircraft_type": f.get("aircraft_type", "N/A"),
                        "status": f.get("status"),
                        "time": flight_time_str
                    })
            except (ValueError, TypeError):
                continue
    except requests.exceptions.RequestException as e:
        print(f"Error fetching current flights: {e}")
    
    # 2. Get SCHEDULED (future) departures and ADD them to the main departure list
    scheduled_params = {
        "start": today_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": today_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "max_pages": 2
    }
    scheduled_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights/scheduled_departures"
    try:
        scheduled_resp = requests.get(scheduled_url, headers=headers, params=scheduled_params, timeout=10)
        scheduled_resp.raise_for_status()
        scheduled_data = scheduled_resp.json()
        
        for f in scheduled_data.get("scheduled_departures", []):
            if not f: continue
            flight_time_str = f.get("scheduled_off")
            if not flight_time_str: continue
            try:
                time_str_for_parsing = flight_time_str.replace('Z', '+00:00')
                flight_dt_utc = datetime.datetime.fromisoformat(time_str_for_parsing)
                flight_dt_local = flight_dt_utc.astimezone(tz)
                
                if flight_dt_local >= now_local:
                    scheduled_flight = {
                        "ident": f.get("ident"),
                        "destination": (f.get("destination") or {}).get("code_icao", "N/A"),
                        "aircraft_type": f.get("aircraft_type", "N/A"),
                        "status": "PLANNED",
                        "time": flight_time_str
                    }
                    # *** CHANGE: Add scheduled flights to the main departures list ***
                    all_departures.append(scheduled_flight)
            except (ValueError, TypeError):
                continue
    except requests.exceptions.RequestException as e:
        print(f"Error fetching scheduled departures: {e}")

    # 3. Get SCHEDULED (future) arrivals and keep them separate
    scheduled_arrivals_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights/scheduled_arrivals"
    try:
        scheduled_arr_resp = requests.get(scheduled_arrivals_url, headers=headers, params=scheduled_params, timeout=10)
        scheduled_arr_resp.raise_for_status()
        scheduled_arr_data = scheduled_arr_resp.json()
        
        for f in scheduled_arr_data.get("scheduled_arrivals", []):
            if not f: continue
            flight_time_str = f.get("scheduled_on") or f.get("scheduled_in")
            if not flight_time_str: continue
            try:
                time_str_for_parsing = flight_time_str.replace('Z', '+00:00')
                flight_dt_utc = datetime.datetime.fromisoformat(time_str_for_parsing)
                flight_dt_local = flight_dt_utc.astimezone(tz)
                
                if flight_dt_local >= now_local:
                    all_scheduled_arrivals.append({
                        "ident": f.get("ident"),
                        "origin": (f.get("origin") or {}).get("code_icao", "N/A"),
                        "aircraft_type": f.get("aircraft_type", "N/A"),
                        "status": "PLANNED",
                        "time": flight_time_str
                    })
            except (ValueError, TypeError):
                continue
    except requests.exceptions.RequestException as e:
        print(f"Error fetching scheduled arrivals: {e}")

    # For simplicity, the unused scheduled_departures and active arrivals keys are removed
    flights_data = {
        "departures": filter_duplicate_flights(all_departures)[:15],
        "scheduled_arrivals": filter_duplicate_flights(all_scheduled_arrivals)[:15]
    }
    return flights_data

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
        lat, lon = AIRPORT_LAT, AIRPORT_LON
        nws_headers = {'User-Agent': 'Mozilla/5.0'}
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
        temp_c = data.get("temperature", {}).get("value")
        wind_kmh = data.get("windSpeed", {}).get("value")
        summary = data.get("textDescription", "")
        if temp_c is None or wind_kmh is None:
            return jsonify({"error": "NWS weather data incomplete"}), 404
        wind_mph = round(wind_kmh * 0.621371)
        return jsonify({"temp": temp_c, "wind_speed": wind_mph, "summary": summary})
    except requests.exceptions.RequestException:
        return jsonify({"error": "Failed to fetch weather"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
