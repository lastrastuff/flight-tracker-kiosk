import os
import requests
import json
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
# Hard-coded coordinates for KASG to reduce FlightAware API calls
AIRPORT_LAT = 36.17473947369698
AIRPORT_LON = -94.12315969007389

# --- Helper Functions ---
def is_airport_open():
    tz = pytz.timezone('America/Chicago')
    now = datetime.datetime.now(tz)
    weekday, hour = now.weekday(), now.hour
    return (6 <= hour < 21) if 0 <= weekday <= 4 else (7 <= hour < 19)

@cache.memoize(timeout=1800)
def fetch_flightaware_data():
    headers = {"x-apikey": AERO_API_KEY}
    params = {"max_pages": 1}
    flights_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights"
    resp = requests.get(flights_url, headers=headers, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    arrivals = data.get("arrivals", [])
    departures = data.get("departures", [])
    flights_data = {
        "arrivals": [{"ident": f.get("ident"), "origin": (f.get("origin") or {}).get("code_icao", "N/A"), "aircraft_type": f.get("aircraft_type", "N/A"), "status": f.get("status"), "time": f.get("actual_on") or f.get("estimated_on") or f.get("scheduled_on")} for f in arrivals[:15] if f],
        "departures": [{"ident": f.get("ident"), "destination": (f.get("destination") or {}).get("code_icao", "N/A"), "aircraft_type": f.get("aircraft_type", "N/A"), "status": f.get("status"), "time": f.get("actual_off") or f.get("estimated_off") or f.get("scheduled_off")} for f in departures[:15] if f]
    }
    return flights_data

# --- Routes ---
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
    """Fetches weather from the NWS using hard-coded airport coordinates."""
    if not is_airport_open():
        return jsonify({"error": "Airport is closed"}), 400
    try:
        # Use hard-coded coordinates instead of FlightAware API call
        lat, lon = AIRPORT_LAT, AIRPORT_LON
        
        # Step 1: Use coordinates to find the nearest NWS station grid
        nws_headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        points_url = f"https://api.weather.gov/points/{lat},{lon}"
        points_resp = requests.get(points_url, headers=nws_headers, timeout=10)
        points_resp.raise_for_status()
        
        # Step 2: Get the URL for the list of nearby stations
        observation_stations_url = points_resp.json().get("properties", {}).get("observationStations")
        if not observation_stations_url:
            return jsonify({"error": "NWS grid did not return stations URL"}), 500

        # Step 3: Get the list of stations and pick the first one's ID
        stations_resp = requests.get(observation_stations_url, headers=nws_headers, timeout=10)
        stations_resp.raise_for_status()
        features = stations_resp.json().get("features", [])
        if not features:
            return jsonify({"error": "NWS did not find nearby stations"}), 500
        
        closest_station_id = features[0].get("properties", {}).get("stationIdentifier")
        if not closest_station_id:
            return jsonify({"error": "Closest station has no ID"}), 500
        
        # Step 4: Build the final URL for the latest observation and fetch it
        latest_obs_url = f"https://api.weather.gov/stations/{closest_station_id}/observations/latest"
        final_weather_resp = requests.get(latest_obs_url, headers=nws_headers, timeout=10)
        final_weather_resp.raise_for_status()
        data = final_weather_resp.json().get("properties", {})
        
        temp_c = data.get("temperature", {}).get("value")
        wind_kmh = data.get("windSpeed", {}).get("value")
        summary = data.get("textDescription", "")  # Get the weather summary

        if temp_c is None or wind_kmh is None:
            return jsonify({"error": "NWS weather data incomplete"}), 404

        wind_mph = round(wind_kmh * 0.621371)
        weather_info = {
            "temp": temp_c,
            "wind_speed": wind_mph,
            "summary": summary  # Add the summary to the response
        }
        return jsonify(weather_info)
        
    except requests.exceptions.RequestException:
        return jsonify({"error": "Failed to fetch weather"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
