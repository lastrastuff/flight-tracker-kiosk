document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('loader');
    const boardTitle = document.getElementById('board-title');
    const currentTimeSpan = document.getElementById('current-time');
    const arrivalsBoard = document.getElementById('arrivals-board');
    const departuresBoard = document.getElementById('departures-board');
    const arrivalsTbody = document.querySelector('#arrivals-table tbody');
    const departuresTbody = document.querySelector('#departures-table tbody');

    let flightData = {};
    let currentView = 'arrivals';
    let scrollInterval = null;

    const REFRESH_INTERVAL = 1800000; // Fetch new data every 10 minutes
    const SWITCH_INTERVAL = 60000;   // Switch views every 60 seconds (unused in new logic)

    function updateClock() {
        // ... (Clock function remains the same)
    }

    function createFlipText(text) {
        // ... (createFlipText function remains the same)
    }

    function manageScrolling() {
        // ... (Scrolling function remains the same)
    }
    
    function updateTable(tbody, flights, type) {
        // ... (Table update function remains the same)
    }

    function updateDisplay() {
        // ... (Display update function remains the same)
    }

    function fetchAndStoreFlightData() {
        if (!flightData.arrivals) {
            loader.style.display = 'block';
        }
        fetch('/api/flights')
            .then(response => response.json())
            .then(data => {
                loader.style.display = 'none';
                
                // --- NEW: Handle "Closed" or "Error" messages ---
                if (data.message || data.error) {
                    const message = data.message || data.error;
                    boardTitle.textContent = message;
                    arrivalsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">-</td></tr>`;
                    departuresTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">-</td></tr>`;
                    return; // Stop further processing
                }

                flightData = data;
                if (!scrollInterval) {
                     updateDisplay();
                }
            })
            .catch(error => {
                loader.style.display = 'none';
                console.error('Fetch error:', error);
            });
    }

    function switchView() {
        currentView = (currentView === 'arrivals') ? 'departures' : 'arrivals';
        updateDisplay();
    }
    
    // Re-pasting the full functions to be safe
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
            timeZone: 'America/Chicago',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
        currentTimeSpan.textContent = `LOCAL TIME: ${timeString}`;
    }

    function createFlipText(text) {
        if (!text) text = 'N/A';
        return text.toString().toUpperCase().split('').map(char => `<span>${char === ' ' ? '&nbsp;' : char}</span>`).join('');
    }

    function manageScrolling() {
        if (scrollInterval) clearInterval(scrollInterval);
        const scrollContainer = document.querySelector('.flight-boards');
        scrollContainer.scrollTo(0, 0);

        setTimeout(() => {
            if (scrollContainer.scrollHeight > scrollContainer.clientHeight) {
                scrollInterval = setInterval(() => {
                    if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight) {
                        clearInterval(scrollInterval);
                        setTimeout(switchView, 8000);
                    } else {
                        scrollContainer.scrollBy(0, 1);
                    }
                }, 50);
            } else {
                setTimeout(switchView, 8000);
            }
        }, 8000);
    }
    
    function updateTable(tbody, flights, type) {
        tbody.innerHTML = '';
        if (!flights || flights.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">No ${type} data available.</td></tr>`;
            return;
        }
        flights.forEach(flight => {
            const row = document.createElement('tr');
            const flightTime = flight.time ? new Date(flight.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
            let status = flight.status || 'unknown';
            if (status.toLowerCase() === 'estimated arrival') { status = 'ETA'; }
            const statusClass = status.toLowerCase().replace(/\s+/g, '-');
            row.classList.add(`status-${statusClass}`);
            const cells = type === 'arrival' ? `<td>${createFlipText(flight.ident)}</td><td>${createFlipText(flight.origin)}</td><td>${createFlipText(flight.aircraft_type)}</td><td>${createFlipText(status)}</td><td>${createFlipText(flightTime)}</td>` : `<td>${createFlipText(flight.ident)}</td><td>${createFlipText(flight.destination)}</td><td>${createFlipText(flight.aircraft_type)}</td><td>${createFlipText(status)}</td><td>${createFlipText(flightTime)}</td>`;
            row.innerHTML = cells;
            tbody.appendChild(row);
        });
    }
    
    function updateDisplay() {
        if (currentView === 'arrivals') {
            boardTitle.textContent = 'ARRIVALS';
            arrivalsBoard.classList.remove('hidden');
            departuresBoard.classList.add('hidden');
            if (flightData.arrivals) {
                updateTable(arrivalsTbody, flightData.arrivals, 'arrival');
            }
        } else {
            boardTitle.textContent = 'DEPARTURES';
            departuresBoard.classList.remove('hidden');
            arrivalsBoard.classList.add('hidden');
            if (flightData.departures) {
                updateTable(departuresTbody, flightData.departures, 'departure');
            }
        }
        manageScrolling();
    }

    updateClock();
    setInterval(updateClock, 1000);
    fetchAndStoreFlightData(); // Initial fetch
    setInterval(fetchAndStoreFlightData, 300000); // Check for new data every 5 minutes
});
