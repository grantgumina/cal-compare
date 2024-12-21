document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('findOverlaps').addEventListener('click', findOverlappingMeetings);
  document.getElementById('addCalendar').addEventListener('click', addCalendarInput);
  let calendarCount = 2;  // Start with 2 inputs
});

async function findOverlappingMeetings() {
  try {
    console.log('Starting authentication...');
    
    // Try to get the token
    const authResult = await chrome.identity.getAuthToken({ 
      interactive: true 
    });
    
    console.log('Auth result:', authResult);
    
    // Format the token properly
    const token = authResult.token || authResult;  // handle different response formats
    
    if (!token) {
      throw new Error('No token received');
    }
    
    // Test the token with a simple calendar API call
    const testResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('Test API response:', testResponse.status);
    const testData = await testResponse.json();
    console.log('Test API data:', testData);
    
    // Get all calendar emails
    const calendarEmails = Array.from(document.getElementsByClassName('calendar-input'))
      .map(input => input.value)
      .filter(email => email.trim() !== '');

    if (calendarEmails.length < 2) {
      document.getElementById('results').innerHTML = 'Please enter at least 2 email addresses';
      return;
    }
    
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
    console.error('Detailed error:', error);
    document.getElementById('results').innerHTML = 'Authentication error: ' + error.message;
  }
}

async function fetchCalendarEvents(calendarId, timeMin, timeMax, token) {
  try {
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
    console.log('Calendar data for', calendarId, ':', data);  // Debug log
    return data.items || [];
  } catch (error) {
    console.error('Error fetching calendar:', calendarId, error);
    throw error;
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
  calendarCount++;
}
