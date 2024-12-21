let calendarCount = 2;  // Start with 2 since we begin with 2 input fields

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('findOverlaps').addEventListener('click', findOverlappingMeetings);
  document.getElementById('addCalendar').addEventListener('click', addCalendarInput);
  
  // Set up autocomplete for initial inputs
  setupAutocomplete(document.querySelectorAll('.calendar-input'));

  // Set default date range (today to 7 days from now)
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  document.getElementById('start-date').value = formatDate(today);
  document.getElementById('end-date').value = formatDate(nextWeek);

  // Add date validation
  document.getElementById('start-date').addEventListener('change', validateDates);
  document.getElementById('end-date').addEventListener('change', validateDates);

  // Convert existing inputs to new format
  const existingInputs = document.querySelectorAll('#calendar-inputs > div');
  existingInputs.forEach((div, index) => {
    if (index >= 2) { // Only add delete buttons to additional inputs
      const input = div.querySelector('.calendar-input');
      if (input) {
        div.className = 'input-row';
        const wrapper = document.createElement('div');
        wrapper.className = 'input-group';
        div.innerHTML = ''; // Clear the div
        wrapper.appendChild(input);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Remove email';
        deleteBtn.addEventListener('click', () => div.remove());
        wrapper.appendChild(deleteBtn);
        
        div.appendChild(wrapper);
      }
    }
  });
});

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Validate that end date is after start date
function validateDates() {
  const startDate = new Date(document.getElementById('start-date').value);
  const endDate = new Date(document.getElementById('end-date').value);
  
  if (endDate < startDate) {
    alert('End date must be after start date');
    document.getElementById('end-date').value = document.getElementById('start-date').value;
  }
}

// Function to manage saved emails
function getSavedEmails() {
  const saved = localStorage.getItem('savedEmails');
  return saved ? JSON.parse(saved) : [];
}

function saveEmail(email) {
  if (!email) return;
  
  let emails = getSavedEmails();
  if (!emails.includes(email)) {
    emails.push(email);
    localStorage.setItem('savedEmails', JSON.stringify(emails));
    console.log('Saved new email:', email);
    console.log('Current saved emails:', emails);
  }
}

// Function to set up autocomplete for an input
function setupAutocomplete(inputs) {
  inputs.forEach(input => {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const dropdown = document.createElement('div');
    dropdown.className = 'email-dropdown';
    wrapper.appendChild(dropdown);

    // Input event handlers
    input.addEventListener('input', () => {
      const value = input.value.toLowerCase();
      const emails = getSavedEmails();
      const matches = value ? 
        emails.filter(email => email.toLowerCase().includes(value)) : 
        emails;

      if (matches.length) {
        dropdown.style.display = 'block';
        dropdown.innerHTML = matches
          .map(email => `<div class="email-option">${email}</div>`)
          .join('');
      } else {
        dropdown.style.display = 'none';
      }
    });

    // Focus handler to show all options
    input.addEventListener('focus', () => {
      const emails = getSavedEmails();
      if (emails.length) {
        dropdown.style.display = 'block';
        dropdown.innerHTML = emails
          .map(email => `<div class="email-option">${email}</div>`)
          .join('');
      }
    });

    // Click handler for dropdown options
    dropdown.addEventListener('click', (e) => {
      if (e.target.classList.contains('email-option')) {
        input.value = e.target.textContent;
        dropdown.style.display = 'none';
      }
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  });
}

async function findOverlappingMeetings() {
  try {
    const startDate = new Date(document.getElementById('start-date').value);
    const endDate = new Date(document.getElementById('end-date').value);
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const calendarInputs = Array.from(document.getElementsByClassName('calendar-input'));
    const calendarEmails = calendarInputs
      .map(input => input.value.trim())
      .filter(email => email !== '');

    if (calendarEmails.length < 2) {
      document.getElementById('results').innerHTML = 'Please enter at least 2 email addresses';
      return;
    }

    // Save each valid email
    calendarEmails.forEach(email => {
      console.log('Saving email:', email);
      saveEmail(email);
    });

    console.log('Getting auth token...');
    // Modified auth token request
    const authResult = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ 
        interactive: true,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
      }, function(token) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });

    if (!authResult) {
      throw new Error('Failed to get authentication token');
    }

    console.log('Token received:', authResult ? 'Yes' : 'No');

    // Modify fetchCalendarEvents calls to use proper token format
    const allCalendarEvents = [];
    for (const email of calendarEmails) {
      try {
        const events = await fetchCalendarEvents(
          email, 
          startDate, 
          endDate, 
          authResult  // Pass the token directly
        );
        allCalendarEvents.push(events);
      } catch (error) {
        console.error('Error fetching calendar for', email, error);
        document.getElementById('results').innerHTML += `<br>Error fetching calendar for ${email}: ${error.message}`;
      }
    }

    if (allCalendarEvents.length < 2) {
      throw new Error('Could not fetch enough calendars to compare');
    }

    const overlappingMeetings = findMultiCalendarOverlaps(allCalendarEvents, calendarEmails);
    displayResults(overlappingMeetings, allCalendarEvents);

  } catch (error) {
    console.error('Error:', error);
    document.getElementById('results').innerHTML = 'Error: ' + error.message;
  }
}

async function fetchCalendarEvents(calendarId, timeMin, timeMax, token) {
  try {
    console.log('Fetching calendar for:', calendarId, 'from:', timeMin, 'to:', timeMax);
    
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const url = `${calendarUrl}?${params.toString()}`;
    console.log('Request URL:', url);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,  // Token should be correct now
        'Accept': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error Response:', errorData);
      throw new Error(`Calendar API error: ${errorData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Successfully fetched events for:', calendarId, 'Count:', data.items?.length);
    
    return data.items || [];
  } catch (error) {
    console.error('Error fetching calendar for:', calendarId, error);
    throw new Error(`Failed to fetch calendar events for ${calendarId}: ${error.message}`);
  }
}

// Helper function to check if a time slot overlaps with all calendars
function isCommonOverlap(timeSlot, eventsList) {
  return eventsList.every(events => 
    events.some(event => {
      const eventStart = getEventTime(event.start);
      const eventEnd = getEventTime(event.end);
      
      return timeSlot.start.getTime() === eventStart.getTime() && 
             timeSlot.end.getTime() === eventEnd.getTime();
    })
  );
}

function isAllDayEvent(event) {
  // All-day events use 'date' instead of 'dateTime' in their start/end times
  return !event.start.dateTime || !event.end.dateTime;
}

function findMultiCalendarOverlaps(allEvents, emails) {
  const overlaps = [];
  
  // Filter out all-day events from all calendars first
  const validEvents = allEvents.map(calendarEvents => 
    calendarEvents.filter(event => !isAllDayEvent(event))
  );

  // Debug log
  console.log('Events after filtering all-day events:', validEvents);
  
  validEvents[0].forEach(baseEvent => {
    const start = getEventTime(baseEvent.start);
    const end = getEventTime(baseEvent.end);
    
    if (!start || !end) {
      console.warn('Invalid time for event:', baseEvent);
      return;
    }

    if (isCommonOverlap({ start, end }, validEvents.slice(1))) {
      const overlappingEvents = validEvents.map((events, index) => {
        const event = events.find(e => 
          eventsOverlap({
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() }
          }, e)
        );
        return {
          email: emails[index],
          title: event?.summary || 'Busy',
          start: getEventTime(event?.start),
          end: getEventTime(event?.end)
        };
      });

      overlaps.push({
        events: overlappingEvents,
        start,
        end
      });
    }
  });
  
  return overlaps;
}

function eventsOverlap(event1, event2) {
  try {
    // Get exact start and end times
    const start1 = getEventTime(event1.start);
    const end1 = getEventTime(event1.end);
    const start2 = getEventTime(event2.start);
    const end2 = getEventTime(event2.end);
    
    // Check for exact match of start AND end times
    return start1.getTime() === start2.getTime() && 
           end1.getTime() === end2.getTime();
  } catch (error) {
    console.error('Event overlap error:', error, { event1, event2 });
    return false;
  }
}

// Helper function to safely get event time
function getEventTime(timeObj) {
  if (!timeObj) {
    console.error('Missing time object:', timeObj);
    return null;
  }
  
  // Handle all-day events (date) and regular events (dateTime)
  const timeString = timeObj.dateTime || timeObj.date;
  if (!timeString) {
    console.error('No date or dateTime found:', timeObj);
    return null;
  }
  
  return new Date(timeString);
}

// Update calculateStats to also exclude all-day events
function calculateStats(overlappingMeetings, allEvents) {
  // Calculate total overlap duration in hours
  const totalOverlapHours = overlappingMeetings.reduce((total, meeting) => {
    const duration = (meeting.end - meeting.start) / (1000 * 60 * 60);
    return total + duration;
  }, 0);

  // Calculate total meeting hours per person (excluding all-day events)
  const personStats = {};
  allEvents.forEach((events, index) => {
    const regularEvents = events.filter(event => !isAllDayEvent(event));
    const email = regularEvents[0]?.organizer?.email || 'Unknown';
    const totalHours = regularEvents.reduce((total, event) => {
      const start = getEventTime(event.start);
      const end = getEventTime(event.end);
      const duration = (end - start) / (1000 * 60 * 60);
      return total + duration;
    }, 0);
    personStats[email] = totalHours;
  });

  return {
    totalOverlapHours: totalOverlapHours.toFixed(1),
    personStats: Object.entries(personStats).map(([email, hours]) => ({
      email,
      totalHours: hours.toFixed(1),
      overlapPercentage: ((totalOverlapHours / hours) * 100).toFixed(1)
    }))
  };
}

function displayResults(overlappingMeetings, allEvents) {
  const resultsDiv = document.getElementById('results');
  const stats = calculateStats(overlappingMeetings, allEvents);
  
  const dateRange = `${document.getElementById('start-date').value} and ${document.getElementById('end-date').value}`;
  
  if (overlappingMeetings.length === 0) {
    resultsDiv.innerHTML = `
      <div class="results-container">
        <div class="stats-card">
          <h3>No overlapping meetings found between ${dateRange}</h3>
        </div>
      </div>
    `;
    return;
  }
  
  resultsDiv.innerHTML = `
    <div class="results-container">
      <div class="stats-card">
        <h3>Meeting Statistics</h3>
        <div class="stat-item">
          <span class="stat-label">Total Shared Meeting Time:</span>
          <span class="stat-value">${stats.totalOverlapHours} hours</span>
        </div>
        <div class="stat-details">
          ${stats.personStats.map(person => `
            <div class="person-stat">
              <div class="email">${person.email}</div>
              <div class="stat-row">
                <span class="stat-label">Total Meeting Hours:</span>
                <span class="stat-value">${person.totalHours}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Shared Meeting %:</span>
                <span class="stat-value">${person.overlapPercentage}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress" style="width: ${person.overlapPercentage}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="meetings-card">
        <h3>Overlapping Meetings (${overlappingMeetings.length})</h3>
        ${overlappingMeetings.map(meeting => `
          <div class="meeting">
            ${meeting.events.map(event => 
              `<div>${event.email}: ${event.title}</div>`
            ).join('')}
            <div class="meeting-time">
              ${meeting.start.toLocaleString()} - ${meeting.end.toLocaleString()}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function addCalendarInput() {
  const inputDiv = document.createElement('div');
  inputDiv.className = 'input-row';
  inputDiv.innerHTML = `
    <div class="input-group">
      <input type="email" class="calendar-input" placeholder="Colleague's email #${calendarCount + 1}">
      <button class="delete-btn" title="Remove email">&times;</button>
    </div>
  `;
  document.getElementById('calendar-inputs').appendChild(inputDiv);
  
  // Add click handler for delete button
  const deleteBtn = inputDiv.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', () => {
    inputDiv.remove();
  });
  
  // Setup autocomplete for the new input
  setupAutocomplete(inputDiv.querySelectorAll('.calendar-input'));
  calendarCount++;
}
