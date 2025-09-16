document.addEventListener('DOMContentLoaded', () => {
    // Element references
    const loader = document.getElementById('loader');
    const boardTitle = document.getElementById('board-title');
    const currentTimeSpan = document.getElementById('current-time');
    const weatherSpan = document.getElementById('weather-text');
    const arrivalsBoard = document.getElementById('arrivals-board');
    const departuresBoard = document.getElementById('departures-board');
    const weatherBoard = document.getElementById('weather-board');
    const arrivalsTbody = document.querySelector('#arrivals-table tbody');
    const departuresTbody = document.querySelector('#departures-table tbody');

    let flightData = {};
    let currentView = 'departures'; // Start on departures instead of arrivals
    let scrollInterval = null;
    let viewSwitchTimeout = null;
    let isInitialLoad = true;
    const REFRESH_INTERVAL = 1800000; // 30 minutes

    function createFlipText(text = 'N/A') {
        return text.toString().trim().toUpperCase().split('').filter(char => 
            char !== '' && char !== ' ' || char === ' ' // Keep spaces but filter empty strings
        ).map(char =>
            `<span>${char === ' ' ? '&nbsp;' : char}</span>`
        ).join('');
    }

    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
            timeZone: 'America/Chicago',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        currentTimeSpan.textContent = `LOCAL TIME: ${timeString}`;
    }

    function fetchWeather() {
        fetch('/api/weather')
            .then(r => r.json())
            .then(data => {
                if (data.temp !== undefined && data.wind_speed !== undefined) {
                    const tempC = parseFloat(data.temp);
                    const tempF = Math.round((tempC * 9/5) + 32);

                    let weatherEmoji = '☀️';
                    const summary = (data.summary || "").toLowerCase();
                    if (summary.includes('cloudy') || summary.includes('overcast')) weatherEmoji = '☁️';
                    else if (summary.includes('rain') || summary.includes('shower')) weatherEmoji = '🌧️';
                    else if (summary.includes('storm')) weatherEmoji = '⛈️';
                    else if (summary.includes('snow')) weatherEmoji = '❄️';
                    else if (summary.includes('fog') || summary.includes('mist')) weatherEmoji = '🌫️';

                    weatherSpan.textContent = `${tempF}°F ${weatherEmoji} ${data.wind_speed} MPH WIND`;
                }
            })
            .catch(e => console.error("Could not fetch weather:", e));
    }

    function updateTable(tbody, flights, type) {
        tbody.innerHTML = '';
        if (!flights || flights.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">No ${type} data available.</td></tr>`;
            return;
        }

        const sortedFlights = [...flights].sort((a, b) => {
            const getStatusPriority = (status) => {
                const statusLower = (status || '').toLowerCase();
                if (statusLower.includes('planned')) return 1; // PLANNED flights go first
                if (statusLower.includes('en-route') || statusLower.includes('en route')) return 2;
                if (statusLower.includes('eta') || statusLower.includes('estimated')) return 3;
                if (statusLower.includes('future') || statusLower.includes('planned')) return 4;
                if (statusLower.includes('scheduled')) return 4;
                return 5;
            };
            
            const pA = getStatusPriority(a.status);
            const pB = getStatusPriority(b.status);
            
            if (pA !== pB) return pA - pB;

            const tA = a.time ? new Date(a.time).getTime() : 0;
            const tB = b.time ? new Date(b.time).getTime() : 0;
            
            return (a.status || '').toLowerCase().includes('planned')
                ? (tA - tB) // For planned flights, sort by time ascending (earliest first)
                : (tB - tA); // For other flights, sort by time descending (latest first)
        });

        sortedFlights.forEach(flight => {
            const row = document.createElement('tr');
            
            // Fixed time conversion - FlightAware sends UTC times
            let time = 'N/A';
            if (flight.time) {
                try {
                    let timeStr = flight.time;
                    if (timeStr.endsWith('Z')) {
                        timeStr = timeStr.slice(0, -1) + '+00:00';
                    }
                    
                    const flightDate = new Date(timeStr);
                    time = flightDate.toLocaleTimeString('en-US', {
                        timeZone: 'America/Chicago',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });
                } catch (error) {
                    console.error('Time conversion error:', error, flight.time);
                    time = 'N/A';
                }
            }

            let status = flight.status || 'Unknown';
            if (status.toLowerCase() === 'estimated arrival') status = 'ETA';

            // Determine the place based on flight type or existing data
            let place = 'N/A';
            if (type === 'scheduled') {
                place = flight.type === 'arrival' ? (flight.origin || 'N/A') : (flight.destination || 'N/A');
            } else if (type === 'arrival') {
                place = flight.origin || 'N/A';
            } else { // departure
                place = flight.destination || 'N/A';
            }

            row.classList.add(`status-${status.toLowerCase().replace(/\s+/g, '-')}`);
            row.innerHTML = `
                <td>${createFlipText(flight.ident)}</td>
                <td>${createFlipText(place)}</td>
                <td>${createFlipText(flight.aircraft_type)}</td>
                <td>${createFlipText(status)}</td>
                <td>${createFlipText(time)}</td>
            `;
            tbody.appendChild(row);
        });
    }

    function manageScrolling() {
        if (scrollInterval) clearInterval(scrollInterval);
        const scrollContainer = document.querySelector('.flight-boards');
        scrollContainer.scrollTo(0, 0);

        const shouldScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight;
        
        if (shouldScroll) {
            // Long list - wait 8s, then start scrolling
            viewSwitchTimeout = setTimeout(() => {
                scrollInterval = setInterval(() => {
                    if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight) {
                        // Reached bottom - clear scrolling and wait 8s more before switching
                        clearInterval(scrollInterval);
                        viewSwitchTimeout = setTimeout(switchView, 8000);
                    } else {
                        scrollContainer.scrollBy(0, 1);
                    }
                }, 50);
            }, 8000);
        } else {
            // Short list - just wait 8s and switch
            viewSwitchTimeout = setTimeout(switchView, 8000);
        }
    }

    function switchView() {
        // Cycle: departures -> scheduled -> weather -> departures
        if (currentView === 'departures') {
            // Check if there are any scheduled flights to show
            const hasScheduled = (flightData.scheduled_departures && flightData.scheduled_departures.length > 0) ||
                               (flightData.scheduled_arrivals && flightData.scheduled_arrivals.length > 0);
            currentView = hasScheduled ? 'scheduled' : 'weather';
        } else if (currentView === 'scheduled') {
            currentView = 'weather';
        } else { // weather view
            if (flightData.departures && flightData.departures.length > 0) {
                currentView = 'departures';
            } else {
                currentView = 'weather'; // Stay on weather if no departures
            }
        }
        updateDisplay();
    }

    function updateDisplay() {
        clearTimeout(viewSwitchTimeout);
        if (scrollInterval) clearInterval(scrollInterval);

        departuresBoard.classList.add('hidden');
        arrivalsBoard.classList.add('hidden');
        weatherBoard.classList.add('hidden');

        if (currentView === 'departures') {
            boardTitle.textContent = 'DEPARTURES';
            departuresBoard.classList.remove('hidden');
            if (flightData.departures && flightData.departures.length > 0) {
                updateTable(departuresTbody, flightData.departures, 'departure');
                manageScrolling();
            } else {
                setTimeout(switchView, 1000);
            }
        } else if (currentView === 'scheduled') {
            boardTitle.textContent = 'SCHEDULED ARRIVALS';
            arrivalsBoard.classList.remove('hidden'); // Reuse arrivals board for scheduled flights
            
            // Combine scheduled arrivals and departures, with arrivals first
            const scheduledFlights = [];
            
            // Add scheduled arrivals FIRST
            if (flightData.scheduled_arrivals) {
                flightData.scheduled_arrivals.forEach(flight => {
                    scheduledFlights.push({
                        ...flight,
                        type: 'arrival',
                        destination: flight.origin, // Use origin as "place" for arrivals
                        origin: flight.origin // Keep origin for arrivals
                    });
                });
            }
            
            // Add scheduled departures SECOND
            if (flightData.scheduled_departures) {
                flightData.scheduled_departures.forEach(flight => {
                    scheduledFlights.push({
                        ...flight,
                        type: 'departure',
                        destination: flight.destination, // Keep destination for departures
                        origin: flight.destination // Use destination as "place" for display
                    });
                });
            }
            
            if (scheduledFlights.length > 0) {
                updateTable(arrivalsTbody, scheduledFlights, 'scheduled');
                manageScrolling();
            } else {
                setTimeout(switchView, 1000);
            }
        } else if (currentView === 'arrivals') {
            // Keep arrivals logic in case you want to re-enable it later
            boardTitle.textContent = 'ARRIVALS';
            arrivalsBoard.classList.remove('hidden');
            if (flightData.arrivals && flightData.arrivals.length > 0) {
                updateTable(arrivalsTbody, flightData.arrivals, 'arrival');
                manageScrolling();
            } else {
                setTimeout(switchView, 1000);
            }
        } else {
            boardTitle.textContent = 'LOCAL RADAR';
            weatherBoard.classList.remove('hidden');
            viewSwitchTimeout = setTimeout(switchView, 30000);
        }
    }

    function fetchAndStoreFlightData() {
        if (isInitialLoad) loader.style.display = 'block';

        fetch('/api/flights')
            .then(r => r.json())
            .then(data => {
                loader.style.display = 'none';
                
                // Debug: Log the raw API response
                console.log('API Response:', data);
                
                if (data.message || data.error) {
                    const message = data.message || data.error;
                    boardTitle.textContent = message;
                    departuresTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">-</td></tr>`;
                    arrivalsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">-</td></tr>`;

                    if (isInitialLoad) {
                        viewSwitchTimeout = setTimeout(switchView, 30000);
                        isInitialLoad = false;
                    }
                    return;
                }

                flightData = data;
                
                // Debug: Log what we're storing
                console.log('Departures found:', flightData.departures?.length || 0);
                console.log('Scheduled departures found:', flightData.scheduled_departures?.length || 0);
                console.log('Scheduled arrivals found:', flightData.scheduled_arrivals?.length || 0);
                
                if (isInitialLoad) {
                    updateDisplay();
                    isInitialLoad = false;
                }
            })
            .catch(e => {
                loader.style.display = 'none';
                console.error('Fetch error:', e);
            });
    }

    updateClock();
    setInterval(updateClock, 1000);

    fetchWeather();
    setInterval(fetchWeather, 600000);

    fetchAndStoreFlightData();
    setInterval(fetchAndStoreFlightData, REFRESH_INTERVAL);
});
