const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const cors = require('cors'); // Import cors


const app = express();
const PORT = process.env.PORT || 3000;

// CORS options
const corsOptions = {
  origin: '*', // Allow requests from any origin
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};

// Apply the CORS middleware
app.use(cors(corsOptions));

// ... (the rest of your code remains the same) ...
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const USERS_DATA_PATH = path.join(__dirname, 'users.json'); // Path to store user data
// Array to store events
const eventsArray = [];

// Middleware to parse request bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    console.error('Error loading saved credentials:', err.message);
    return null;
  }
}

async function saveCredentials(client) {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
    console.log('Credentials saved successfully.');
  } catch (err) {
    console.error('Error saving credentials:', err.message);
  }
}

async function authorize() {
  try {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
    return client;
  } catch (err) {
    console.error('Authorization error:', err.message);
    throw err;
  }
}


app.post('/register', async (req, res) => {
  try {
    const { username, email, password} = req.body;

    // Read existing user data
    let usersData = [];
    try {
      const data = await fs.readFile(USERS_DATA_PATH, 'utf8');
      usersData = JSON.parse(data);
    } catch (error) {
      // Ignore if the file doesn't exist or is empty
    }

    // Check for existing user
    const existingUser = usersData.find(user => user.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Add new user with events
    const newUser = {
      username,
      email,
      password,
      events:[],
    };
    usersData.push(newUser);

    // Write updated user data to the file
    await fs.writeFile(USERS_DATA_PATH, JSON.stringify(usersData, null, 2));

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Route handler for retrieving events
app.get('/events', async (req, res) => {
  try {
    const auth = await authorize();
    const events = await listEvents(auth);

    // Convert events data to JSON string
    const eventsJSON = JSON.stringify(events);

    res.json({ events: eventsJSON }); // Send events data as a JSON string
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Error fetching events' });
  }
});



// Route handler for user login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Read user data from the file
    let usersData = JSON.parse(await fs.readFile(USERS_DATA_PATH, 'utf8'));

    // Find the user with the provided username and password
    const userIndex = usersData.findIndex(
      (user) => user.username === username && user.password === password
    );
    if (userIndex === -1) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // User is authenticated
    // Fetch events from API (assuming listEvents returns events data)
    try {
      const auth = await authorize();
      events = await listEvents(auth);
    } catch (error) {
      console.error('Error fetching events:', error);
      return res.status(500).json({ error: 'Error fetching events' });
    }

    // Update the user's events data with the fetched events
    usersData[userIndex].events.push(events)

    // Write updated user data back to the file
    await fs.writeFile(USERS_DATA_PATH, JSON.stringify(usersData, null, 2));

    res.status(200).json({ message: 'Login successful' });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
async function listEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });
  const events = response.data.items;
  return events;
}

const moment = require('moment-timezone');

app.post('/calculate-free-time', async (req, res) => {
  try {
    const { username } = req.body;
    // Read the JSON data from the file
    let userData = await fs.readFile(USERS_DATA_PATH, 'utf8');
    let usersData = JSON.parse(userData);

    // Find the user with the provided username
    const userIndex = usersData.findIndex(user => user.username === username);
    if (userIndex === -1) {
      return res.status(404).json({ error: `User with username '${username}' not found` });
    }

    // Flatten the events array
    const allEvents = usersData[userIndex].events.flat();

    // Get the current date and time in the Israel/Jerusalem time zone
    const israelTimezone = 'Asia/Jerusalem';
    const currentDate = moment().tz(israelTimezone);
    const startOfWeek = currentDate.clone().startOf('day');
    const endOfWeek = startOfWeek.clone().add(1, 'week');

    // Filter out events that occur within the next week
    const eventsThisWeek = allEvents.filter(event => {
      const eventTime = moment(event.start.dateTime).tz(israelTimezone);
      return eventTime.isBetween(startOfWeek, endOfWeek, null, '[]');
    });

    // Calculate free time between future events
    const freeTime = [];
    let previousEventEnd = startOfWeek.hours(7);

    for (const event of eventsThisWeek) {
      const currentEventStart = moment(event.start.dateTime).tz(israelTimezone);
      const timeDifference = currentEventStart.diff(previousEventEnd, 'minutes');

      let adjustedPreviousEventEnd = previousEventEnd.clone();
      let adjustedCurrentEventStart = currentEventStart.clone();

      // Adjust times to fall within the 7 AM to 9 PM range
      adjustedPreviousEventEnd = adjustTimes(adjustedPreviousEventEnd, startOfWeek, endOfWeek);
      adjustedCurrentEventStart = adjustTimes(adjustedCurrentEventStart, startOfWeek, endOfWeek);

      if (timeDifference > 0 && adjustedCurrentEventStart.isAfter(adjustedPreviousEventEnd)) {
        freeTime.push({
          start: adjustedPreviousEventEnd.format('YYYY-MM-DDTHH:mm:ss'),
          end: adjustedCurrentEventStart.format('YYYY-MM-DDTHH:mm:ss'),
          duration: timeDifference
        });
      }

      previousEventEnd = moment(event.end.dateTime).tz(israelTimezone);
    }

    // Update user's freeTime property
    usersData[userIndex].freeTime = freeTime;

    // Write updated user data back to the file
    await fs.writeFile(USERS_DATA_PATH, JSON.stringify(usersData, null, 2));
    res.json({ freeTime });
  } catch (error) {
    console.error('Error reading or parsing users data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function adjustTimes(time, startOfWeek, endOfWeek) {
  if (time.isBefore(startOfWeek.hours(7))) {
    return startOfWeek.clone().hours(7);
  } else if (time.isAfter(endOfWeek.hours(7))) {
    return endOfWeek.clone().hours(21);
  } else if (time.isAfter(time.clone().startOf('day').hours(21))) {
    return time.clone().add(1, 'day').hours(7);
  } else {
    return time;
  }
}
let groups = []; // Initialize groups array

// Load groups data asynchronously when server starts
fs.readFile('groups.json')
    .then(data => {
        if (data.length > 0) {
            groups = JSON.parse(data); // Parse JSON data
        }
    })
    .catch(err => {
        console.error('Error reading groups.json:', err);
    });

// Route to create a group
app.post('/groups', async (req, res) => {
    const { groupName } = req.body;

    // Check if groupName is provided
    if (!groupName) {
        return res.status(400).json({ error: 'Group name is required' });
    }

    try {
        // Check if groupName already exists
        const groupExistsIndex = groups.findIndex(group => group.name === groupName);
        if (groupExistsIndex !== -1) {
            return res.status(400).json({ error: 'Group name already taken, please try another name' });
        }

        // If groupName is unique, push the new group into groups array
        groups.push({ name: groupName, users: [] });
        await saveGroupsToFile(groups);
        res.status(201).json({ message: 'Group created successfully' });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

async function saveGroupsToFile(groups) {
    try {
        await fs.writeFile('groups.json', JSON.stringify(groups, null, 2));
        console.log('Groups data saved to groups.json');
    } catch (error) {
        console.error('Error saving groups data to groups.json:', error);
        throw error; // Re-throw the error to be caught by the caller
    }
}



// Route to add a user to a group
app.post('/groups/:groupName/users', (req, res) => {
  const { groupName } = req.params;
  const { username } = req.body;
  const group = groups.find(group => group.name === groupName);
  if (!group) {
      return res.status(404).json({ error: 'Group not found' });
  }
  if (!username) {
      return res.status(400).json({ error: 'Username is required' });
  }
  group.users.push(username);
  saveGroupsToFile(groups); // Pass the groups array here
  res.status(201).json({ message: 'User added to group successfully' });
});

// Function to save groups data to groups.json
async function saveGroupsToFile(groups) {
try {
    await fs.writeFile('groups.json', JSON.stringify(groups, null, 2));
    console.log('Groups data saved to groups.json');
} catch (error) {
    console.error('Error saving groups data to groups.json:', error);
    throw error; // Re-throw the error to be caught by the caller
}
}


  
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});