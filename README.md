# Flight Tracker Kiosk ✈️

A simple, Docker-based web application to display real-time flight arrivals and departures for a specific airport, styled as a retro flipboard. It is designed to run as a dedicated kiosk display.

## Features

* Displays real-time arrivals and departures from the FlightAware AeroAPI.
* Cycles between Arrivals and Departures boards.
* Auto-scrolls if the flight list is longer than the screen.
* Caches API data to stay within free tier limits.
* Only requests data during configurable airport operating hours.
* Styled with a retro "flipboard" aesthetic.

## How to Run

1.  **Prerequisites:** You will need `docker` and `docker-compose` installed.
2.  **Clone the repository:**
    ```bash
    git clone [https://github.com/lastrastuff/flight-tracker-kiosk.git](https://github.com/lastrastuff/flight-tracker-kiosk.git)
    cd flight-tracker-kiosk
    ```
3.  **Create an environment file:** Create a file named `.env` in the project root.
4.  **Add your API key:** Add your FlightAware AeroAPI key to the `.env` file:
    ```
    AERO_API_KEY=YOUR_KEY_HERE
    ```
5.  **Run the application:**
    ```bash
    sudo docker-compose up --build -d
    ```
6.  The kiosk will be accessible at `http://localhost:8080`.
