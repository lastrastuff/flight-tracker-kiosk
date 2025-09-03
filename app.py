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

config = {
    "CACHE_TYPE": "SimpleCache",
    "CACHE_DEFAULT_TIMEOUT": 1800
}

app = Flask(__name__, static_folder='static', static_url_path='')
app.config.from_mapping(config)
cache = Cache(app)

# --- Constants ---
AERO_API_URL = "https://aeroapi.flightaware.com/aeroapi"
AERO_API_KEY = os.getenv("AERO_API_KEY")
AIRPORT_CODE = "KASG"

# --- Helper Functions ---
def is_airport_open():
    """Checks if the airport is within operating hours in its local timezone."""
    tz = pytz.timezone('America/Chicago')
    now = datetime.datetime.now(tz)
    weekday = now.weekday()  # Monday is 0, Sunday is 6
    hour = now.hour

    if 0 <= weekday <= 4:  # Monday - Friday
        return 6 <= hour < 21  # 6:00 AM to 8:59 PM
    else:  # Saturday - Sunday
        return 7 <= hour < 19  # 7:00 AM to 6:59 PM

@cache.memoize()
def fetch_flightaware_data():
    """Makes the actual API calls. The @cache.memoize decorator ensures this
    function only runs if the result is not already in the cache."""
    headers = {"x-apikey": AERO_API_KEY}
    params = {"max_pages": 1}
    flights_data = {"arrivals": [], "departures": []}

    # --- Arrivals ---
    arrivals_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights/arrivals"
    arrivals_resp = requests.get(arrivals_url, headers=headers, params=params, timeout=10)
    arrivals_resp.raise_for_status()
    arrivals = arrivals_resp.json().get("arrivals", [])

    # --- Departures ---
    departures_url = f"{AERO_API_URL}/airports/{AIRPORT_CODE}/flights/departures"
    departures_resp = requests.get(departures_url, headers=headers, params=params, timeout=10)
    departures_resp.raise_for_status()
    departures = departures_resp.json().get("departures", [])

    # Format data
    flights_data["arrivals"] = [
        {"ident": f.get("ident"), "origin": (f.get("origin") or {}).get("code_icao", "N/A"), "aircraft_type": f.get("aircraft_type", "N/A"), "status": f.get("status"), "time": f.get("actual_on") or f.get("estimated_on") or f.get("scheduled_on")}
        for f in arrivals[:15] if f
    ]
    flights_data["departures"] = [
        {"ident": f.get("ident"), "destination": (f.get("destination") or {}).get("code_icao", "N/A"), "aircraft_type": f.get("aircraft_type", "N/A"), "status": f.get("status"), "time": f.get("actual_off") or f.get("estimated_off") or f.get("scheduled_off")}
        for f in departures[:15] if f
    ]
    return flights_data

# --- Routes ---
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/flights')
def get_flights():
    if not is_airport_open():
        cache.clear()  # Clear cache so we get fresh data when airport re-opens
        return jsonify({
            "arrivals": [],
            "departures": [],
            "message": "AIRPORT IS CURRENTLY CLOSED"
        })
    
    try:
        data = fetch_flightaware_data()
        return jsonify(data)
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"API request failed: {e}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
