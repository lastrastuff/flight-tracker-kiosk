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
    let currentView = 'arrivals';
    let scrollInterval = null;
    let viewSwitchTimeout = null;
    let isInitialLoad = true;
    const REFRESH_INTERVAL = 1800000; // 30 minutes

    function fetchWeather() {
        fetch('/api/weather')
            .then(response => response.json())
            .then(data => {
                if (data.temp !== undefined && data.wind_speed !== undefined) {
                    const tempC = parseFloat(data.temp);
                    const tempF = Math.round((tempC * 9/5) + 32);
                    
                    // Logic to select a weather emoji based on summary
                    let weatherEmoji = '☀️'; // Default to sunny
                    const summary = (data.summary || "").toLowerCase();
                    if (summary.includes('cloudy') || summary.includes('overcast')) {
                        weatherEmoji = '☁️';
                    } else if (summary.includes('rain') || summary.includes('shower')) {
                        weatherEmoji = '🌧️';
                    } else if (summary.includes('storm')) {
                        weatherEmoji = '⛈️';
                    } else if (summary.includes('snow')) {
                        weatherEmoji = '❄️';
                    } else if (summary.includes('fog') || summary.includes('mist')) {
                        weatherEmoji = '🌫️';
                    }
                    
                    // Updated display string with emoji
                    weatherSpan.textContent = `${tempF}°F ${weatherEmoji} ${data.wind_speed} MPH WIND`;
                }
            })
            .catch(error => console.error("Could not fetch weather:", error));
    }

    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { 
            timeZone: 'America/Chicago', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit', 
            hour12: true 
        });
        currentTimeSpan.textContent = `LOCAL TIME: ${timeString}`;
    }

    function createFlipText(text) {
        if (!text) text = 'N/A';
        return text.toString().toUpperCase().split('').map(char => 
            `<span>${char === ' ' ? '&nbsp;' : char}</span>`
        ).join('');
    }

    function manageScrolling() {
        if (scrollInterval) clearInterval(scrollInterval);
        const scrollContainer = document.querySelector('.flight-boards');
        scrollContainer.scrollTo(0, 0);
        
        viewSwitchTimeout = setTimeout(() => {
            if (scrollContainer.scrollHeight > scrollContainer.clientHeight) {
                scrollInterval = setInterval(() => {
                    if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight) {
                        clearInterval(scrollInterval);
                        viewSwitchTimeout = setTimeout(switchView, 8000);
                    } else {
                        scrollContainer.scrollBy(0, 1);
                    }
                }, 50);
            } else {
                viewSwitchTimeout = setTimeout(switchView, 8000);
            }
        }, 8000);
    }
    
    function updateTable(tbody, flights, type) {
        tbody.innerHTML = '';
        if (!flights || flights.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">No ${type} data available.</td></tr>`;
            return;
        }
        
        // Sort flights by status priority first, then by time
        const sortedFlights = [...flights].sort((a, b) => {
            // Define status priority (lower number = higher priority)
            const getStatusPriority = (status) => {
                const statusLower = (status || '').toLowerCase();
                if (statusLower.includes('en-route') || statusLower.includes('en route')) return 1;
                if (statusLower.includes('eta') || statusLower.includes('estimated')) return 2;
                if (statusLower.includes('scheduled')) return 3;
                if (statusLower.includes('arrived') || statusLower.includes('departed') || statusLower.includes('landed')) return 5;
                return 4; // Unknown statuses
            };
            
            const priorityA = getStatusPriority(a.status);
            const priorityB = getStatusPriority(b.status);
            
            // First sort by status priority
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            
            // If same priority, sort by time (most recent first)
            const timeA = a.time ? new Date(a.time).getTime() : 0;
            const timeB = b.time ? new Date(b.time).getTime() : 0;
            return timeB - timeA;
        });
        
        sortedFlights.forEach(flight => {
            const row = document.createElement('tr');
            const flightTime = flight.time ? 
                new Date(flight.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
                'N/A';
            
            let status = flight.status || 'unknown';
            if (status.toLowerCase() === 'estimated arrival') { 
                status = 'ETA'; 
            }
            
            const statusClass = status.toLowerCase().replace(/\s+/g, '-');
            row.classList.add(`status-${statusClass}`);
            
            const cells = type === 'arrival' ? 
                `<td>${createFlipText(flight.ident)}</td>
                 <td>${createFlipText(flight.origin)}</td>
                 <td>${createFlipText(flight.aircraft_type)}</td>
                 <td>${createFlipText(status)}</td>
                 <td>${createFlipText(flightTime)}</td>` : 
                `<td>${createFlipText(flight.ident)}</td>
                 <td>${createFlipText(flight.destination)}</td>
                 <td>${createFlipText(flight.aircraft_type)}</td>
                 <td>${createFlipText(status)}</td>
                 <td>${createFlipText(flightTime)}</td>`;
            
            row.innerHTML = cells;
            tbody.appendChild(row);
        });
    }

    function updateDisplay() {
        clearTimeout(viewSwitchTimeout);
        if (scrollInterval) clearInterval(scrollInterval);
        
        // Hide all boards
        arrivalsBoard.classList.add('hidden');
        departuresBoard.classList.add('hidden');
        weatherBoard.classList.add('hidden');

        if (currentView === 'arrivals') {
            boardTitle.textContent = 'ARRIVALS';
            arrivalsBoard.classList.remove('hidden');
            if (flightData.arrivals) {
                updateTable(arrivalsTbody, flightData.arrivals, 'arrival');
            }
            manageScrolling();
        } else if (currentView === 'departures') {
            boardTitle.textContent = 'DEPARTURES';
            departuresBoard.classList.remove('hidden');
            if (flightData.departures) {
                updateTable(departuresTbody, flightData.departures, 'departure');
            }
            manageScrolling();
        } else { // weather
            boardTitle.textContent = 'LOCAL RADAR';
            weatherBoard.classList.remove('hidden');
            viewSwitchTimeout = setTimeout(switchView, 30000);
        }
    }

    function fetchAndStoreFlightData() {
        if (isInitialLoad) { 
            loader.style.display = 'block'; 
        }
        
        fetch('/api/flights')
            .then(response => response.json())
            .then(data => {
                loader.style.display = 'none';
                
                if (data.message || data.error) {
                    const message = data.message || data.error;
                    boardTitle.textContent = message;
                    arrivalsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">-</td></tr>`;
                    departuresTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">-</td></tr>`;
                    
                    if (isInitialLoad) {
                        viewSwitchTimeout = setTimeout(switchView, 30000);
                        isInitialLoad = false;
                    }
                    return;
                }
                
                flightData = data;
                if (isInitialLoad) {
                    updateDisplay();
                    isInitialLoad = false;
                }
            })
            .catch(error => {
                loader.style.display = 'none';
                console.error('Fetch error:', error);
            });
    }

    function switchView() {
        if (currentView === 'arrivals') {
            currentView = 'departures';
        } else if (currentView === 'departures') {
            currentView = 'weather';
        } else {
            currentView = 'arrivals';
        }
        updateDisplay();
    }

    // Initialize the application
    updateClock();
    setInterval(updateClock, 1000);
    
    fetchWeather();
    setInterval(fetchWeather, 600000); // Refresh weather every 10 minutes
    
    fetchAndStoreFlightData();
    setInterval(fetchAndStoreFlightData, REFRESH_INTERVAL); // Refresh flight data every 30 minutes
});
