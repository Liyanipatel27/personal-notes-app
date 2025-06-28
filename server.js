require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const marked = require('marked');
const PDFDocument = require('pdfkit');
const sanitizeHtml = require('sanitize-html');
const WebSocket = require('ws');
const JSZip = require('jszip');

const app = express();
const port = process.env.PORT || 3001;

// WebSocket server setup
const wss = new WebSocket.Server({ noServer: true });

// Store active connections
const activeConnections = new Map();

wss.on('connection', (ws, req) => {
    const noteId = req.url.split('?noteId=')[1];
    const userId = req.user.id;

    if (!noteId) {
        ws.close();
        return;
    }

    // Store connection
    if (!activeConnections.has(noteId)) {
        activeConnections.set(noteId, new Set());
    }
    activeConnections.get(noteId).add({ ws, userId });

    // Handle incoming messages
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const { type, content } = data;

            // Broadcast to all users viewing the same note
            const connections = activeConnections.get(noteId);
            if (connections) {
                connections.forEach(({ ws: clientWs, userId: clientUserId }) => {
                    if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type,
                            content,
                            userId,
                            timestamp: new Date().toISOString()
                        }));
                    }
                });
            }

            // If it's an edit, save version history
            if (type === 'edit') {
                await saveNoteVersion(noteId, userId, content);
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        const connections = activeConnections.get(noteId);
        if (connections) {
            connections.delete({ ws, userId });
            if (connections.size === 0) {
                activeConnections.delete(noteId);
            }
        }
    });
});

// Helper function to save note version
async function saveNoteVersion(noteId, userId, content) {
    const query = `
        INSERT INTO note_versions (note_id, user_id, title, content, content_format)
        SELECT id, ?, title, content, content_format
        FROM notes
        WHERE id = ?
    `;
    return new Promise((resolve, reject) => {
        db.query(query, [userId, noteId], (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// Middleware
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, etc)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:3001',
            'http://127.0.0.1:3001',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            // Add your production domain here
            'https://your-app-name.onrender.com'
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            console.log('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Add security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json());
app.use(express.static('public'));

// Database connection
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'notes_app',
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : undefined
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to MySQL database');

    // Create version history table if not exists
    db.query(`
        CREATE TABLE IF NOT EXISTS note_versions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            note_id INT NOT NULL,
            user_id INT NOT NULL,
            title TEXT,
            content TEXT,
            content_format VARCHAR(20),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Create note attachments table if not exists
    db.query(`
        CREATE TABLE IF NOT EXISTS note_attachments (
            id INT PRIMARY KEY AUTO_INCREMENT,
            note_id INT NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_path VARCHAR(255) NOT NULL,
            file_type VARCHAR(100),
            file_size INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
    `);
});

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Log the attempt
        console.log('Registration attempt:', { username, email });

        const hashedPassword = await bcrypt.hash(password, 10);

        const query = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
        db.query(query, [username, email, hashedPassword], (err, results) => {
            if (err) {
                console.error('Database error during registration:', err);
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: 'Error creating user: ' + err.message });
            }
            console.log('User registered successfully:', { username, email });
            res.status(201).json({ message: 'User created successfully' });
        });
    } catch (error) {
        console.error('Unexpected error during registration:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Error logging in' });
        if (results.length === 0) return res.status(400).json({ error: 'User not found' });

        const user = results[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET);
        res.json({ token, username: user.username });
    });
});

// Notes CRUD operations

// Create note
app.post('/api/notes', authenticateToken, upload.single('file'), (req, res) => {
    console.log('Received note creation request:', {
        userId: req.user.id,
        title: req.body.title,
        hasContent: !!req.body.content,
        hasFile: !!req.file,
        categoryId: req.body.categoryId,
        contentFormat: req.body.contentFormat
    });

    const { title, content, contentFormat, categoryId, color } = req.body;
    const userId = req.user.id;
    const filePath = req.file ? req.file.path : null;

    const noteQuery = 'INSERT INTO notes (user_id, category_id, title, content, content_format, attachment_path, color) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(noteQuery, [userId, categoryId, title, content, contentFormat, filePath, color], (err, results) => {
        if (err) {
            console.error('Error creating note in database:', err);
            return res.status(500).json({ error: 'Error creating note: ' + err.message });
        }
        console.log('Note created successfully with ID:', results.insertId);
        res.status(201).json({ message: 'Note created successfully', noteId: results.insertId });
    });
});

// Get all notes for a user
app.get('/api/notes', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { search, category, sort, order } = req.query;

    console.log('Fetching notes for user:', userId, 'with filters:', { search, category, sort, order });

    let query = `
        SELECT n.*, c.name as category_name, c.color as category_color
        FROM notes n
        LEFT JOIN categories c ON n.category_id = c.id
        WHERE n.user_id = ?
    `;
    const params = [userId];

    if (search) {
        query += ' AND (n.title LIKE ? OR n.content LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    if (category) {
        query += ' AND n.category_id = ?';
        params.push(category);
    }

    if (sort) {
        const validSortFields = ['title', 'created_at', 'updated_at'];
        const sortField = validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
        query += ` ORDER BY n.${sortField} ${sortOrder}`;
    } else {
        query += ' ORDER BY n.is_pinned DESC, n.created_at DESC';
    }

    console.log('Executing query:', query);
    console.log('With parameters:', params);

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching notes:', err);
            return res.status(500).json({ error: 'Error fetching notes' });
        }
        console.log(`Found ${results.length} notes for user ${userId}`);
        res.json(results);
    });
});

// Get single note
app.get('/api/notes/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    console.log(`Fetching note ${id} for user ${userId}`);

    const query = `
        SELECT n.*, c.name as category_name, c.color as category_color
        FROM notes n
        LEFT JOIN categories c ON n.category_id = c.id
        WHERE n.id = ? AND n.user_id = ?
    `;
    
    db.query(query, [id, userId], (err, results) => {
        if (err) {
            console.error('Error fetching note:', err);
            return res.status(500).json({ error: 'Error fetching note' });
        }
        if (results.length === 0) {
            console.log(`Note ${id} not found or not accessible to user ${userId}`);
            return res.status(404).json({ error: 'Note not found' });
        }
        console.log(`Successfully fetched note ${id} for user ${userId}`);
        res.json(results[0]);
    });
});

// Update note
app.put('/api/notes/:id', authenticateToken, upload.single('file'), (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, content, contentFormat, categoryId, color } = req.body;
    const filePath = req.file ? req.file.path : null;

    console.log(`Updating note ${id} for user ${userId}`);

    // First check if the note belongs to the user
    db.query('SELECT id FROM notes WHERE id = ? AND user_id = ?', [id, userId], (err, results) => {
        if (err) {
            console.error('Error checking note ownership:', err);
            return res.status(500).json({ error: 'Error updating note' });
        }
        if (results.length === 0) {
            console.log(`Note ${id} not found or not accessible to user ${userId}`);
            return res.status(404).json({ error: 'Note not found' });
        }

        const query = 'UPDATE notes SET title = ?, content = ?, content_format = ?, category_id = ?, color = ?, attachment_path = COALESCE(?, attachment_path) WHERE id = ? AND user_id = ?';
        db.query(query, [title, content, contentFormat, categoryId, color, filePath, id, userId], (err, results) => {
            if (err) {
                console.error('Error updating note:', err);
                return res.status(500).json({ error: 'Error updating note' });
            }
            if (results.affectedRows === 0) {
                console.log(`Failed to update note ${id} for user ${userId}`);
                return res.status(404).json({ error: 'Note not found' });
            }
            console.log(`Successfully updated note ${id} for user ${userId}`);
            res.json({ message: 'Note updated successfully' });
        });
    });
});

// Delete note
app.delete('/api/notes/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    console.log(`Deleting note ${id} for user ${userId}`);

    const query = 'DELETE FROM notes WHERE id = ? AND user_id = ?';
    db.query(query, [id, userId], (err, results) => {
        if (err) {
            console.error('Error deleting note:', err);
            return res.status(500).json({ error: 'Error deleting note' });
        }
        if (results.affectedRows === 0) {
            console.log(`Note ${id} not found or not accessible to user ${userId}`);
            return res.status(404).json({ error: 'Note not found' });
        }
        console.log(`Successfully deleted note ${id} for user ${userId}`);
        res.json({ message: 'Note deleted successfully' });
    });
});

// Download note attachment
app.get('/api/notes/:id/download', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const query = 'SELECT attachment_path FROM notes WHERE id = ? AND user_id = ?';
    db.query(query, [id, userId], (err, results) => {
        if (err) {
            console.error('Error fetching file:', err);
            return res.status(500).json({ error: 'Error fetching file' });
        }
        if (results.length === 0 || !results[0].attachment_path) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = results[0].attachment_path;
        res.download(filePath);
    });
});

// Download note with attachment as ZIP
app.get('/api/notes/:id/download-with-attachment', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const query = 'SELECT * FROM notes WHERE id = ? AND user_id = ?';
    db.query(query, [id, userId], (err, results) => {
        if (err) {
            console.error('Error fetching note:', err);
            return res.status(500).json({ error: 'Error fetching note' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Note not found' });
        }

        const note = results[0];
        const zip = new JSZip();

        // Add note content to ZIP
        let content = note.content;
        switch (note.content_format) {
            case 'markdown':
                content = `# ${note.title}\n\n${content}`;
                break;
            case 'html':
                content = `<!DOCTYPE html><html><head><title>${note.title}</title></head><body><h1>${note.title}</h1>${content}</body></html>`;
                break;
            default:
                content = `${note.title}\n\n${content}`;
        }

        // Add note content file
        const fileExtension = note.content_format === 'markdown' ? 'md' : 
                             note.content_format === 'html' ? 'html' : 'txt';
        zip.file(`note-${id}.${fileExtension}`, content);

        // Add attachment if it exists
        if (note.attachment_path && require('fs').existsSync(note.attachment_path)) {
            const attachmentData = require('fs').readFileSync(note.attachment_path);
            const attachmentName = require('path').basename(note.attachment_path);
            zip.file(`attachment-${attachmentName}`, attachmentData);
        }

        // Generate and send ZIP
        zip.generateAsync({ type: 'nodebuffer' }).then(buffer => {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename=note-${id}-with-attachment.zip`);
            res.send(buffer);
        }).catch(err => {
            console.error('Error creating ZIP:', err);
            res.status(500).json({ error: 'Error creating download package' });
        });
    });
});

// Category endpoints
app.post('/api/categories', authenticateToken, (req, res) => {
    const { name, color } = req.body;
    const userId = req.user.id;

    // Log the request data
    console.log('Creating category:', { name, color, userId });

    // Validate input
    if (!name) {
        console.error('Category creation failed: Name is required');
        return res.status(400).json({ error: 'Category name is required' });
    }

    const query = 'INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)';
    db.query(query, [userId, name, color], (err, results) => {
        if (err) {
            console.error('Error creating category:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'A category with this name already exists' });
            }
            return res.status(500).json({ error: 'Error creating category: ' + err.message });
        }
        console.log('Category created successfully:', { id: results.insertId, name, color });
        res.status(201).json({ message: 'Category created successfully', categoryId: results.insertId });
    });
});

app.get('/api/categories', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const query = 'SELECT * FROM categories WHERE user_id = ? ORDER BY name';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error fetching categories' });
        res.json(results);
    });
});

// Tag endpoints
app.post('/api/tags', authenticateToken, (req, res) => {
    const { name } = req.body;
    const userId = req.user.id;

    const query = 'INSERT INTO tags (user_id, name) VALUES (?, ?)';
    db.query(query, [userId, name], (err, results) => {
        if (err) {
            console.error('Error creating tag:', err);
            return res.status(500).json({ error: 'Error creating tag' });
        }
        res.status(201).json({ message: 'Tag created successfully', tagId: results.insertId });
    });
});

app.get('/api/tags', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const query = 'SELECT * FROM tags WHERE user_id = ? ORDER BY name';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error fetching tags' });
        res.json(results);
    });
});

// Add export endpoints
app.get('/api/notes/:id/export/:format', authenticateToken, (req, res) => {
    const { id, format } = req.params;
    const userId = req.user.id;

    const query = 'SELECT * FROM notes WHERE id = ? AND user_id = ?';
    db.query(query, [id, userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error fetching note' });
        if (results.length === 0) return res.status(404).json({ error: 'Note not found' });

        const note = results[0];
        let content = note.content;

        // Convert content based on format
        switch (note.content_format) {
            case 'markdown':
                content = marked.parse(content);
                break;
            case 'html':
                content = sanitizeHtml(content);
                break;
        }

        // Export based on requested format
        switch (format) {
            case 'pdf':
                const doc = new PDFDocument();
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename=note-${id}.pdf`);
                doc.pipe(res);
                doc.fontSize(20).text(note.title);
                doc.fontSize(12).text(content);
                doc.end();
                break;

            case 'txt':
                res.setHeader('Content-Type', 'text/plain');
                res.setHeader('Content-Disposition', `attachment; filename=note-${id}.txt`);
                res.send(`${note.title}\n\n${content}`);
                break;

            case 'md':
                res.setHeader('Content-Type', 'text/markdown');
                res.setHeader('Content-Disposition', `attachment; filename=note-${id}.md`);
                res.send(`# ${note.title}\n\n${content}`);
                break;

            case 'html':
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Content-Disposition', `attachment; filename=note-${id}.html`);
                res.send(`<!DOCTYPE html><html><head><title>${note.title}</title></head><body><h1>${note.title}</h1>${content}</body></html>`);
                break;

            default:
                res.status(400).json({ error: 'Unsupported export format' });
        }

        // Update last_exported_at
        db.query('UPDATE notes SET last_exported_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    });
});

// Modify the server startup to listen on all network interfaces
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
    console.log('Server is accessible at:');
    console.log(`- Local: http://localhost:${port}`);
    console.log(`- Network: http://${getLocalIP()}:${port}`);
});

// Helper function to get local IP address
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

server.on('upgrade', (request, socket, head) => {
    // Verify JWT token from query string
    const token = request.url.split('?token=')[1]?.split('&')[0];
    if (!token) {
        socket.destroy();
        return;
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            socket.destroy();
            return;
        }

        request.user = user;
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
}); 