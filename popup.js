document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('findOverlaps').addEventListener('click', findOverlappingMeetings);
  document.getElementById('addCalendar').addEventListener('click', addCalendarInput);
  let calendarCount = 2;  // Start with 2 inputs
  
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
  }
}

// Function to set up autocomplete for an input
function setupAutocomplete(inputs) {
  inputs.forEach(input => {
    // Create dropdown container
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const dropdown = document.createElement('div');
    dropdown.className = 'email-dropdown';
    wrapper.appendChild(dropdown);

    // Add styles for dropdown
    const style = document.createElement('style');
    style.textContent = `
      .email-dropdown {
        display: none;
        position: absolute;
        width: 100%;
        max-height: 150px;
        overflow-y: auto;
        border: 1px solid #ddd;
        border-top: none;
        background: white;
        z-index: 1000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .email-option {
        padding: 8px;
        cursor: pointer;
      }
      .email-option:hover {
        background-color: #f0f0f0;
      }
    `;
    document.head.appendChild(style);

    // Input event handlers
    input.addEventListener('input', () => {
      const value = input.value.toLowerCase();
      const emails = getSavedEmails();
      const matches = emails.filter(email => 
        email.toLowerCase().includes(value)
      );

      if (matches.length && value) {
        dropdown.style.display = 'block';
        dropdown.innerHTML = matches
          .map(email => `<div class="email-option">${email}</div>`)
          .join('');
      } else {
        dropdown.style.display = 'none';
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
    displayResults(overlappingMeetings);

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

function findMultiCalendarOverlaps(allEvents, emails) {
  const overlaps = [];
  
  // Filter out any invalid events and log them
  const validEvents = allEvents.map(calendarEvents => 
    calendarEvents.filter(event => {
      if (!event.start || !event.end) {
        console.warn('Invalid event found:', event);
        return false;
      }
      return true;
    })
  );

  // Debug log
  console.log('Processing events:', validEvents);
  
  validEvents[0].forEach(baseEvent => {
    const start = getEventTime(baseEvent.start);
    const end = getEventTime(baseEvent.end);
    
    if (!start || !end) {
      console.warn('Invalid time for event:', baseEvent);
      return;
    }

    // Check if this time slot overlaps with events from all other calendars
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
          title: event?.summary || 'Busy',  // Handle events without titles
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

function displayResults(overlappingMeetings) {
  const resultsDiv = document.getElementById('results');
  
  if (overlappingMeetings.length === 0) {
    resultsDiv.innerHTML = 'No overlapping meetings found';
    return;
  }
  
  resultsDiv.innerHTML = overlappingMeetings
    .map(meeting => `
      <div class="meeting">
        ${meeting.events.map(event => 
          `<div>${event.email}: ${event.title}</div>`
        ).join('')}
        <div>Overlap time: ${meeting.start.toLocaleString()} - ${meeting.end.toLocaleString()}</div>
      </div>
    `)
    .join('');
}

function addCalendarInput() {
  const inputDiv = document.createElement('div');
  inputDiv.innerHTML = `
    <input type="email" class="calendar-input" placeholder="Colleague's email #${calendarCount + 1}">
  `;
  document.getElementById('calendar-inputs').appendChild(inputDiv);
  
  // Set up autocomplete for the new input
  setupAutocomplete(inputDiv.querySelectorAll('.calendar-input'));
  calendarCount++;
}
