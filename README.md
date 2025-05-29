# Notes App

A real-time collaborative notes application with sharing capabilities.

## Features
- Create, edit, and delete notes
- Real-time collaboration
- Share notes via public/private links
- Version history
- Category management
- Rich text editing
- File attachments

## Deployment Instructions

### 1. Create a Render.com Account
1. Go to [Render.com](https://render.com)
2. Sign up for a free account
3. Verify your email

### 2. Create a Database
1. In Render dashboard, click "New +"
2. Select "PostgreSQL"
3. Choose "Free" plan
4. Name your database (e.g., "notes-app-db")
5. Save the database URL and credentials

### 3. Deploy the Application
1. In Render dashboard, click "New +"
2. Select "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - Name: notes-app (or your preferred name)
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free

### 4. Set Environment Variables
In the Render dashboard, add these environment variables:
```
NODE_ENV=production
DB_HOST=your_database_host
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=your_database_name
JWT_SECRET=your_secret_key
```

### 5. Update Application URL
After deployment, update these files with your Render URL:
1. `server.js`: Replace `your-app-name.onrender.com` with your actual Render URL
2. `public/app.js`: Replace `your-app-name.onrender.com` with your actual Render URL

## Local Development
1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your values
3. Install dependencies: `npm install`
4. Start the server: `npm start`
5. Access the app at `http://localhost:3001`

## Security Notes
- Never commit `.env` file
- Use strong passwords
- Keep JWT_SECRET secure
- Regularly update dependencies

## Prerequisites

- Node.js (v14 or higher)
- MySQL (v8 or higher)
- npm or yarn package manager

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd notes-app
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following content:
```
DB_HOST=localhost
DB_USER=your_mysql_username
DB_PASSWORD=your_mysql_password
DB_NAME=notes_app
JWT_SECRET=your_jwt_secret_key
PORT=3000
```

4. Create the database and tables:
- Open MySQL command line or a MySQL client
- Run the SQL commands from `database.sql`

5. Create an `uploads` directory in the root folder:
```bash
mkdir uploads
```

## Running the Application

1. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

## API Endpoints

### Authentication
- POST `/api/register` - Register a new user
- POST `/api/login` - Login user

### Notes
- GET `/api/notes` - Get all notes for the authenticated user
- POST `/api/notes` - Create a new note
- GET `/api/notes/:id` - Get a specific note
- PUT `/api/notes/:id` - Update a note
- DELETE `/api/notes/:id` - Delete a note
- GET `/api/notes/:id/download` - Download note attachment

## Security

- Passwords are hashed using bcrypt
- JWT authentication for protected routes
- File upload validation
- SQL injection prevention using parameterized queries

## Technologies Used

- Backend:
  - Node.js
  - Express.js
  - MySQL
  - JWT for authentication
  - bcrypt for password hashing
  - multer for file uploads

- Frontend:
  - HTML5
  - CSS3
  - JavaScript (ES6+)
  - Bootstrap 5
  - Fetch API

## License

MIT 