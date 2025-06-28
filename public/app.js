// API endpoints
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3001/api'
    : 'https://your-app-name.onrender.com/api';

// DOM Elements
const authForms = document.getElementById('auth-forms');
const notesApp = document.getElementById('notes-app');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const createNoteForm = document.getElementById('createNoteForm');
const editNoteForm = document.getElementById('editNoteForm');
const categoryForm = document.getElementById('categoryForm');
const notesContainer = document.getElementById('notesContainer');
const usernameSpan = document.getElementById('username');
const logoutBtn = document.getElementById('logoutBtn');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const tagFilter = document.getElementById('tagFilter');
const sortOrder = document.getElementById('sortOrder');
const editNoteModal = new bootstrap.Modal(document.getElementById('editNoteModal'));
const categoryModal = new bootstrap.Modal(document.getElementById('categoryModal'));

// State
let currentUser = null;
let authToken = localStorage.getItem('token');
let categories = [];
let tags = [];
let easyMDE = null;

// WebSocket connection
let ws = null;
let currentNoteId = null;

// Initialize rich text editor
function initEditor(elementId) {
    if (easyMDE) {
        easyMDE.toTextArea();
        easyMDE = null;
    }
    
    const textarea = document.getElementById(elementId);
    easyMDE = new EasyMDE({
        element: textarea,
        spellChecker: false,
        status: false,
        toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'link', 'image', '|', 'preview', 'side-by-side', 'fullscreen'],
        autofocus: true
    });
}

// Check if user is logged in
if (authToken) {
    fetchUserData();
}

// Event Listeners
loginForm.addEventListener('submit', handleLogin);
registerForm.addEventListener('submit', handleRegister);
createNoteForm.addEventListener('submit', handleCreateNote);
categoryForm.addEventListener('submit', handleCreateCategory);
logoutBtn.addEventListener('click', handleLogout);
document.getElementById('saveEditBtn').addEventListener('click', handleEditNote);

// Search and filter event listeners
searchInput.addEventListener('input', debounce(fetchNotes, 300));
categoryFilter.addEventListener('change', fetchNotes);
tagFilter.addEventListener('change', fetchNotes);
sortOrder.addEventListener('change', fetchNotes);

// Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        authToken = data.token;
        localStorage.setItem('token', authToken);
        currentUser = { username: data.username };
        localStorage.setItem('username', data.username);
        showNotesApp();
        await Promise.all([fetchCategories(), fetchTags(), fetchNotes()]);
    } catch (error) {
        alert(error.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        alert('Registration successful! Please login.');
        document.getElementById('login-tab').click();
    } catch (error) {
        alert(error.message);
    }
}

async function handleCreateCategory(e) {
    e.preventDefault();
    const name = document.getElementById('categoryName').value;
    const color = document.getElementById('categoryColor').value;

    try {
        const response = await fetch(`${API_URL}/categories`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, color })
        });

        if (!response.ok) throw new Error('Failed to create category');

        document.getElementById('categoryForm').reset();
        await fetchCategories();
    } catch (error) {
        alert(error.message);
    }
}

async function handleCreateNote(e) {
    e.preventDefault();
    const title = document.getElementById('noteTitle').value;
    const content = easyMDE ? easyMDE.value() : document.getElementById('noteContent').value;
    const categoryId = document.getElementById('noteCategory').value;
    const color = document.getElementById('noteColor').value;
    const contentFormat = document.getElementById('contentFormat').value;

    // Validate required fields
    if (!title.trim()) {
        alert('Please enter a title for your note');
        return;
    }
    if (!content.trim()) {
        alert('Please enter some content for your note');
        return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('contentFormat', contentFormat);
    if (categoryId) formData.append('categoryId', categoryId);
    if (color) formData.append('color', color);

    const fileInput = document.getElementById('noteFile');
    if (fileInput.files.length > 0) {
        formData.append('file', fileInput.files[0]);
    }

    try {
        const response = await fetch(`${API_URL}/notes`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        if (!response.ok) throw new Error('Failed to create note');

        document.getElementById('createNoteForm').reset();
        if (easyMDE) easyMDE.value('');
        await fetchNotes();
    } catch (error) {
        alert(error.message);
    }
}

async function handleEditNote(e) {
    e.preventDefault();
    const noteId = document.getElementById('editNoteId').value;
    const title = document.getElementById('editNoteTitle').value;
    const content = easyMDE ? easyMDE.value() : document.getElementById('editNoteContent').value;
    const categoryId = document.getElementById('editNoteCategory').value;
    const color = document.getElementById('editNoteColor').value;
    const contentFormat = document.getElementById('editContentFormat').value;

    // Validate required fields
    if (!title.trim()) {
        alert('Please enter a title for your note');
        return;
    }
    if (!content.trim()) {
        alert('Please enter some content for your note');
        return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('contentFormat', contentFormat);
    if (categoryId) formData.append('categoryId', categoryId);
    if (color) formData.append('color', color);

    const fileInput = document.getElementById('editNoteFile');
    if (fileInput.files.length > 0) {
        formData.append('file', fileInput.files[0]);
    }

    try {
        const response = await fetch(`${API_URL}/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        if (!response.ok) throw new Error('Failed to update note');

        editNoteModal.hide();
        await fetchNotes();
    } catch (error) {
        alert(error.message);
    }
}

async function handleDeleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) return;

    try {
        const response = await fetch(`${API_URL}/notes/${noteId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to delete note');

        fetchNotes();
    } catch (error) {
        alert(error.message);
    }
}

async function exportNote(format) {
    const noteId = document.getElementById('editNoteId').value;
    try {
        const response = await fetch(`${API_URL}/notes/${noteId}/export/${format}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to export note');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `note-${noteId}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        alert(error.message);
    }
}

// Download functions
async function downloadNote(format) {
    const noteId = document.getElementById('editNoteId').value;
    if (!noteId) {
        alert('Please select a note to download');
        return;
    }
    await downloadNoteDirect(noteId, format);
}

async function downloadNoteWithAttachment() {
    const noteId = document.getElementById('editNoteId').value;
    if (!noteId) {
        alert('Please select a note to download');
        return;
    }
    await downloadNoteWithAttachment(noteId);
}

async function downloadNoteDirect(noteId, format) {
    try {
        const response = await fetch(`${API_URL}/notes/${noteId}/export/${format}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to download note');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `note-${noteId}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        alert(error.message);
    }
}

async function downloadNoteWithAttachmentDirect(noteId) {
    try {
        const response = await fetch(`${API_URL}/notes/${noteId}/download-with-attachment`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to download note with attachment');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `note-${noteId}-with-attachment.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        alert(error.message);
    }
}

async function downloadNoteCard(noteId) {
    try {
        // First get the note details to check if it has an attachment
        const noteResponse = await fetch(`${API_URL}/notes/${noteId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!noteResponse.ok) throw new Error('Failed to fetch note details');
        const note = await noteResponse.json();

        // If note has attachment, offer both options
        if (note.attachment_path) {
            const choice = confirm('This note has an attachment. Would you like to download with attachment? Click OK for with attachment, Cancel for note only.');
            if (choice) {
                await downloadNoteWithAttachmentDirect(noteId);
            } else {
                await downloadNoteDirect(noteId, 'txt');
            }
        } else {
            // No attachment, just download the note
            await downloadNoteDirect(noteId, 'txt');
        }
    } catch (error) {
        alert(error.message);
    }
}

function handleLogout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    showAuthForms();
}

async function fetchUserData() {
    try {
        const response = await fetch(`${API_URL}/notes`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Invalid token');

        currentUser = { username: localStorage.getItem('username') };
        showNotesApp();
        await Promise.all([fetchCategories(), fetchTags(), fetchNotes()]);
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        showAuthForms();
    }
}

async function fetchCategories() {
    try {
        const response = await fetch(`${API_URL}/categories`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to fetch categories');

        categories = await response.json();
        updateCategorySelects();
        displayCategories();
    } catch (error) {
        console.error('Error fetching categories:', error);
    }
}

async function fetchTags() {
    try {
        const response = await fetch(`${API_URL}/tags`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to fetch tags');

        tags = await response.json();
        updateTagSelects();
    } catch (error) {
        console.error('Error fetching tags:', error);
    }
}

async function fetchNotes() {
    try {
        const search = searchInput.value;
        const category = categoryFilter.value;
        const sort = sortOrder.value;

        let url = `${API_URL}/notes?`;
        if (search) url += `search=${encodeURIComponent(search)}&`;
        if (category) url += `category=${encodeURIComponent(category)}&`;
        if (sort) {
            const [field, order] = sort.split('-');
            url += `sort=${field}&order=${order}&`;
        }

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to fetch notes');

        const notes = await response.json();
        displayNotes(notes);
    } catch (error) {
        alert(error.message);
    }
}

function updateCategorySelects() {
    const categoryOptions = categories.map(category => 
        `<option value="${category.id}" style="color: ${category.color}">${category.name}</option>`
    ).join('');

    const defaultOption = '<option value="">Select Category</option>';
    const allCategoriesOption = '<option value="">All Categories</option>';

    document.getElementById('noteCategory').innerHTML = defaultOption + categoryOptions;
    document.getElementById('editNoteCategory').innerHTML = defaultOption + categoryOptions;
    document.getElementById('categoryFilter').innerHTML = allCategoriesOption + categoryOptions;
}

function updateTagSelects() {
    const tagOptions = tags.map(tag => 
        `<option value="${tag.id}">${tag.name}</option>`
    ).join('');

    const defaultOption = '<option value="">Select Tags</option>';
    const allTagsOption = '<option value="">All Tags</option>';

    document.getElementById('noteTags').innerHTML = defaultOption + tagOptions;
    document.getElementById('editNoteTags').innerHTML = defaultOption + tagOptions;
    document.getElementById('tagFilter').innerHTML = allTagsOption + tagOptions;
}

function displayCategories() {
    const categoriesList = document.getElementById('categoriesList');
    categoriesList.innerHTML = categories.map(category => `
        <div class="category-item" style="border-left: 4px solid ${category.color}">
            <span>${category.name}</span>
            <button class="btn btn-sm btn-danger" onclick="deleteCategory(${category.id})">
                <i class="bi bi-trash"></i>
            </button>
        </div>
    `).join('');
}

async function deleteCategory(categoryId) {
    if (!confirm('Are you sure you want to delete this category? Notes in this category will not be deleted.')) return;

    try {
        const response = await fetch(`${API_URL}/categories/${categoryId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to delete category');

        await fetchCategories();
    } catch (error) {
        alert(error.message);
    }
}

function displayNotes(notes) {
    notesContainer.innerHTML = '';
    notes.forEach(note => {
        const noteElement = createNoteElement(note);
        notesContainer.appendChild(noteElement);
    });
}

function createNoteElement(note) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4';
    
    const date = new Date(note.created_at).toLocaleDateString();
    const category = categories.find(c => c.id === note.category_id);
    
    col.innerHTML = `
        <div class="note-card ${note.is_pinned ? 'pinned' : ''}" style="background-color: ${note.color}">
            <h3 class="note-title">${note.title}</h3>
            <div class="note-meta">
                ${category ? `
                    <span class="note-category" style="background-color: ${category.color}">
                        ${category.name}
                    </span>
                ` : ''}
            </div>
            <div class="note-content ${note.content_format}">
                ${formatContent(note.content, note.content_format)}
            </div>
            ${note.attachment_path ? `
                <a href="#" class="note-file" onclick="handleDownloadNote(${note.id}); return false;">
                    <i class="bi bi-paperclip"></i> Attachment
                </a>
            ` : ''}
            <div class="note-date">Created: ${date}</div>
            <div class="note-actions">
                <button class="btn btn-sm btn-primary" onclick="openEditModal(${note.id})">
                    <i class="bi bi-pencil"></i> Edit
                </button>
                <button class="btn btn-sm btn-success" onclick="downloadNoteCard(${note.id})">
                    <i class="bi bi-download"></i> Download
                </button>
                <button class="btn btn-sm btn-danger" onclick="handleDeleteNote(${note.id})">
                    <i class="bi bi-trash"></i> Delete
                </button>
            </div>
        </div>
    `;
    
    return col;
}

function formatContent(content, format) {
    switch (format) {
        case 'markdown':
            return marked.parse(content);
        case 'html':
            return sanitizeHtml(content);
        default:
            return content;
    }
}

function openEditModal(noteId) {
    fetch(`${API_URL}/notes/${noteId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(note => {
        document.getElementById('editNoteId').value = note.id;
        document.getElementById('editNoteTitle').value = note.title;
        document.getElementById('editNoteCategory').value = note.category_id || '';
        document.getElementById('editContentFormat').value = note.content_format;
        document.getElementById('editNoteColor').value = note.color;
        
        // Initialize editor with content
        initEditor('editNoteContent');
        easyMDE.value(note.content);

        editNoteModal.show();
    })
    .catch(error => alert('Error loading note: ' + error.message));
}

function showNotesApp() {
    authForms.classList.add('d-none');
    notesApp.classList.remove('d-none');
    usernameSpan.textContent = currentUser.username;
    initEditor('noteContent');
    searchInput.addEventListener('input', debounce(fetchNotes, 300));
    categoryFilter.addEventListener('change', fetchNotes);
    sortOrder.addEventListener('change', fetchNotes);
}

function showAuthForms() {
    authForms.classList.remove('d-none');
    notesApp.classList.add('d-none');
    loginForm.reset();
    registerForm.reset();
    if (easyMDE) {
        easyMDE.toTextArea();
        easyMDE = null;
    }
}

function connectWebSocket(noteId) {
    if (ws) {
        ws.close();
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    const wsUrl = process.env.NODE_ENV === 'production'
        ? `wss://your-app-name.onrender.com?token=${token}&noteId=${noteId}`
        : `ws://${window.location.host}?token=${token}&noteId=${noteId}`;

    ws = new WebSocket(wsUrl);
    currentNoteId = noteId;

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'edit') {
            // Update the editor content if it's from another user
            if (data.userId !== getCurrentUserId()) {
                const editor = easyMDEInstances.get('editNoteContent');
                if (editor) {
                    editor.value(data.content);
                }
            }
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
            if (currentNoteId === noteId) {
                connectWebSocket(noteId);
            }
        }, 5000);
    };
}

// Version history
async function showVersionHistory() {
    const noteId = document.getElementById('editNoteId').value;
    try {
        const response = await fetch(`/api/notes/${noteId}/versions`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const versions = await response.json();
        if (response.ok) {
            const versionList = document.getElementById('versionList');
            versionList.innerHTML = versions.map(version => `
                <div class="list-group-item">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1">Version by ${version.username}</h6>
                        <small>${new Date(version.created_at).toLocaleString()}</small>
                    </div>
                    <p class="mb-1">${version.title}</p>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-outline-primary" onclick="previewVersion(${version.id})">Preview</button>
                        <button class="btn btn-sm btn-outline-success" onclick="restoreVersion(${version.id})">Restore</button>
                    </div>
                </div>
            `).join('');
            
            document.getElementById('versionHistoryModal').classList.add('show');
        } else {
            alert('Failed to load version history');
        }
    } catch (error) {
        console.error('Error loading version history:', error);
        alert('Failed to load version history');
    }
}

async function restoreVersion(versionId) {
    const noteId = document.getElementById('editNoteId').value;
    if (!confirm('Are you sure you want to restore this version? Current changes will be saved as a new version.')) {
        return;
    }

    try {
        const response = await fetch(`/api/notes/${noteId}/restore/${versionId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (response.ok) {
            // Refresh the note content
            const note = await fetchNote(noteId);
            if (note) {
                updateNoteForm(note);
                // Close the version history modal
                document.getElementById('versionHistoryModal').classList.remove('show');
            }
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to restore version');
        }
    } catch (error) {
        console.error('Error restoring version:', error);
        alert('Failed to restore version');
    }
}

// Modify the existing editNote function to use WebSocket
async function editNote(id) {
    try {
        const note = await fetchNote(id);
        if (note) {
            updateNoteForm(note);
            document.getElementById('editNoteModal').classList.add('show');
            // Connect to WebSocket for real-time updates
            connectWebSocket(id);
        }
    } catch (error) {
        console.error('Error editing note:', error);
        alert('Failed to load note');
    }
}

// Modify the saveEditBtn click handler to use WebSocket
document.getElementById('saveEditBtn').addEventListener('click', async () => {
    const noteId = document.getElementById('editNoteId').value;
    const title = document.getElementById('editNoteTitle').value;
    const content = easyMDEInstances.get('editNoteContent').value();
    const categoryId = document.getElementById('editNoteCategory').value;
    const contentFormat = document.getElementById('editContentFormat').value;
    const color = document.getElementById('editNoteColor').value;

    try {
        const response = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                title,
                content,
                categoryId,
                contentFormat,
                color
            })
        });

        if (response.ok) {
            // Send update through WebSocket
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'edit',
                    content: {
                        title,
                        content,
                        categoryId,
                        contentFormat,
                        color
                    }
                }));
            }
            document.getElementById('editNoteModal').classList.remove('show');
            fetchNotes(); // Refresh the notes list
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to update note');
        }
    } catch (error) {
        console.error('Error updating note:', error);
        alert('Failed to update note');
    }
});

// Helper function to get current user ID from JWT token
function getCurrentUserId() {
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.id;
    } catch (error) {
        console.error('Error parsing token:', error);
        return null;
    }
} 