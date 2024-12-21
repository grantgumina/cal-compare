document.getElementById('findOverlaps').addEventListener('click', findOverlappingMeetings);
document.getElementById('addCalendar').addEventListener('click', addCalendarInput);
let calendarCount = 2;  // Start with 2 inputs

function addCalendarInput() {
  const inputDiv = document.createElement('div');
  inputDiv.innerHTML = `
    <input type="email" class="calendar-input" placeholder="Colleague's email #${calendarCount + 1}">
  `;
  document.getElementById('calendar-inputs').appendChild(inputDiv);
  calendarCount++;
}

async function findOverlappingMeetings() {
  // Get all calendar emails
  const calendarEmails = Array.from(document.getElementsByClassName('calendar-input'))
    .map(input => input.value)
    .filter(email => email.trim() !== '');

  if (calendarEmails.length < 2) {
    document.getElementById('results').innerHTML = 'Please enter at least 2 email addresses';
    return;
  }
  
  try {
    const token = await chrome.identity.getAuthToken({ interactive: true });
    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    // Fetch all calendars' events
    const allCalendarEvents = await Promise.all(
      calendarEmails.map(email => 
        fetchCalendarEvents(email, now, oneWeekFromNow, token)
      )
    );
    
    // Find overlapping events across all calendars
    const overlappingMeetings = findMultiCalendarOverlaps(allCalendarEvents, calendarEmails);
    displayResults(overlappingMeetings);
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('results').innerHTML = 'Error: ' + error.message;
  }
}

async function fetchCalendarEvents(calendarId, timeMin, timeMax, token) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
    `timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch calendar events');
  }
  
  const data = await response.json();
  return data.items;
}

function findMultiCalendarOverlaps(allEvents, emails) {
  const overlaps = [];
  
  // Helper function to check if a time slot overlaps with all events
  function isCommonOverlap(timeSlot, eventsList) {
    return eventsList.every(events =>
      events.some(event => 
        eventsOverlap({
          start: { dateTime: timeSlot.start },
          end: { dateTime: timeSlot.end }
        }, event)
      )
    );
  }

  // Use the first calendar's events as a base
  allEvents[0].forEach(baseEvent => {
    const start = new Date(baseEvent.start.dateTime || baseEvent.start.date);
    const end = new Date(baseEvent.end.dateTime || baseEvent.end.date);
    
    // Check if this time slot overlaps with events from all other calendars
    if (isCommonOverlap({ start, end }, allEvents.slice(1))) {
      // Find the actual overlapping period across all calendars
      const overlappingEvents = allEvents.map((events, index) => {
        const event = events.find(e => 
          eventsOverlap({
            start: { dateTime: start },
            end: { dateTime: end }
          }, e)
        );
        return {
          email: emails[index],
          title: event.summary
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
  const start1 = new Date(event1.start.dateTime || event1.start.date);
  const end1 = new Date(event1.end.dateTime || event1.end.date);
  const start2 = new Date(event2.start.dateTime || event2.start.date);
  const end2 = new Date(event2.end.dateTime || event2.end.date);
  
  return start1 < end2 && start2 < end1;
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
