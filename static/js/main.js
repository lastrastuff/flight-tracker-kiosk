document.addEventListener('DOMContentLoaded', () => {
    // Element references
    const loader = document.getElementById('loader');
    const boardTitle = document.getElementById('board-title');
    const currentTimeSpan = document.getElementById('current-time');
    const arrivalsBoard = document.getElementById('arrivals-board');
    const departuresBoard = document.getElementById('departures-board');
    const weatherBoard = document.getElementById('weather-board');
    const arrivalsTbody = document.querySelector('#arrivals-table tbody');
    const departuresTbody = document.querySelector('#departures-table tbody');

    let flightData = {};
    let currentView = 'departures'; // Start on departures
    let scrollInterval = null;
    let viewSwitchTimeout = null;
    let isInitialLoad = true;
    let nextSixAmCheck = null;
    const REFRESH_INTERVAL = 1800000; // 30 minutes

    function createFlipText(text = 'N/A') {
        return String(text).trim().toUpperCase().split('').filter(char =>
            char !== '' && char !== ' ' || char === ' '
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

    function updateTable(tbody, flights, type) {
        tbody.innerHTML = '';
        if (!flights || flights.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5">No ${type} data available.</td></tr>`;
            return;
        }

        try {
            const sortedFlights = [...flights].sort((a, b) => {
                const getStatusPriority = (status) => {
                    const statusLower = String(status || '').toLowerCase();
                    if (statusLower.includes('planned')) return 1;
                    if (statusLower.includes('en-route') || statusLower.includes('en route')) return 2;
                    if (statusLower.includes('eta') || statusLower.includes('estimated')) return 3;
                    return 5;
                };

                const pA = getStatusPriority(a.status);
                const pB = getStatusPriority(b.status);
                if (pA !== pB) return pA - pB;

                const tA = a.time ? new Date(a.time).getTime() : 0;
                const tB = b.time ? new Date(b.time).getTime() : 0;

                if (isNaN(tA) || isNaN(tB)) return 0;

                return String(a.status || '').toLowerCase().includes('planned') ? (tA - tB) : (tB - tA);
            });

            sortedFlights.forEach(flight => {
                const row = document.createElement('tr');
                let time = 'N/A';
                if (flight.time) {
                    const flightDate = new Date(flight.time);
                    if (!isNaN(flightDate.getTime())) {
                        time = flightDate.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false });
                    }
                }

                let status = String(flight.status || 'Unknown');
                // *** THIS IS THE CHANGE: Convert "Estimated Arrival" to "ETA" ***
                if (status.toLowerCase() === 'estimated arrival') status = 'ETA';

                const place = type === 'arrival' ? (flight.origin || 'N/A') : (flight.destination || 'N/A');
                const aircraft = String(flight.aircraft_type || 'N/A');
                const ident = String(flight.ident || 'N/A');

                row.classList.add(`status-${status.toLowerCase().replace(/\s+/g, '-')}`);
                row.innerHTML = `
                    <td>${createFlipText(ident)}</td>
                    <td>${createFlipText(place)}</td>
                    <td>${createFlipText(aircraft)}</td>
                    <td>${createFlipText(status)}</td>
                    <td>${createFlipText(time)}</td>
                `;
                tbody.appendChild(row);
            });
        } catch (error) {
            console.error("A critical error occurred while updating the table:", error);
            tbody.innerHTML = `<tr><td colspan="5">Error displaying flight data.</td></tr>`;
        }
    }

    function manageScrolling() {
        if (scrollInterval) clearInterval(scrollInterval);
        const scrollContainer = document.querySelector('.flight-boards');
        scrollContainer.scrollTo(0, 0);

        const shouldScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight;

        if (shouldScroll) {
            viewSwitchTimeout = setTimeout(() => {
                scrollInterval = setInterval(() => {
                    if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight) {
                        clearInterval(scrollInterval);
                        viewSwitchTimeout = setTimeout(switchView, 8000);
                    } else {
                        scrollContainer.scrollBy(0, 1);
                    }
                }, 50);
            }, 8000);
        } else {
            viewSwitchTimeout = setTimeout(switchView, 8000);
        }
    }

    function switchView() {
        if (currentView === 'departures') {
            const hasScheduledArrivals = flightData.scheduled_arrivals && flightData.scheduled_arrivals.length > 0;
            currentView = hasScheduledArrivals ? 'arrivals' : 'weather';
        } else if (currentView === 'arrivals') {
            currentView = 'weather';
        } else if (currentView === 'weather') {
            currentView = 'departures';
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
        } else if (currentView === 'arrivals') {
            boardTitle.textContent = 'ARRIVALS';
            arrivalsBoard.classList.remove('hidden');
            if (flightData.scheduled_arrivals && flightData.scheduled_arrivals.length > 0) {
                updateTable(arrivalsTbody, flightData.scheduled_arrivals, 'arrival');
                manageScrolling();
            } else {
                setTimeout(switchView, 1000);
            }
        } else if (currentView === 'weather') {
            boardTitle.textContent = 'LOCAL RADAR';
            weatherBoard.classList.remove('hidden');
            viewSwitchTimeout = setTimeout(switchView, 30000); // Show weather for 30s
        }
    }

    function getNext6AM() {
        const now = new Date();
        const next6AM = new Date(now);
        next6AM.setHours(6, 0, 0, 0);
        if (now >= next6AM) {
            next6AM.setDate(next6AM.getDate() + 1);
        }
        return next6AM;
    }

    function schedule6AMRefresh() {
        if (nextSixAmCheck) clearTimeout(nextSixAmCheck);
        const next6AM = getNext6AM();
        const timeUntil6AM = next6AM.getTime() - Date.now();
        console.log(`Next 6 AM refresh scheduled for: ${next6AM.toLocaleString()}`);
        nextSixAmCheck = setTimeout(() => {
            console.log('6 AM refresh triggered - forcing flight data update');
            fetchAndStoreFlightData();
            schedule6AMRefresh();
        }, timeUntil6AM);
    }

    function fetchAndStoreFlightData() {
        if (isInitialLoad) loader.style.display = 'block';

        fetch('/api/flights')
            .then(r => r.json())
            .then(data => {
                loader.style.display = 'none';
                console.log('API Response:', data);

                if (data.message || data.error) {
                    boardTitle.textContent = data.message || data.error;
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
            .catch(e => {
                loader.style.display = 'none';
                console.error('Fetch error:', e);
            });
    }

    // Initialize everything
    updateClock();
    setInterval(updateClock, 1000);
    fetchAndStoreFlightData();
    setInterval(fetchAndStoreFlightData, REFRESH_INTERVAL);
    schedule6AMRefresh();
});
