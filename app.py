# Simple Meet: Real-time location sharing application
# Copyright (C) 2025  SimpleMeet
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.
+
import os
import random
import string
import sqlite3
import time
import logging
from flask import Flask, render_template, request, jsonify, session, g 
from flask_socketio import SocketIO, emit, join_room, leave_room, send
from flask_cors import CORS
import secrets
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('simplemeet.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# --- Configuration & Setup ---
DB_DIR = 'db'
DB_PATH = os.path.join(DB_DIR, 'locations.db')

app = Flask(__name__)
# Use persistent secret key from environment or generate a secure one
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

CORS(app)
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")

# Available colors for users in a room
USER_COLORS = [
    '#E6194B', # Red
    '#3CB44B', # Green
    '#4363D8', # Blue
    '#F58231', # Orange
    '#911EB4', # Purple
    '#46F0F0', # Cyan
    '#FABEBE', # Pink
    '#008080', # Teal
    '#FFE119', # Yellow
    '#E6BEFF', # Lavender
] # Brighter, more distinct colors

# Ensure the database directory exists
os.makedirs(DB_DIR, exist_ok=True)

# --- Database Functions ---

def get_db():
    """Opens a new database connection if there is none yet for the current application context."""
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        g.db.execute('PRAGMA foreign_keys = ON')  # Ensure foreign keys are enabled
        g.db.row_factory = sqlite3.Row 
    return g.db

@app.teardown_appcontext
def close_db(error):
    """Closes the database again at the end of the request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    """Initializes the database and creates tables if they don't exist."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute('PRAGMA foreign_keys = ON')  # Enable foreign key constraints
    conn.execute('PRAGMA journal_mode = WAL')  # Better concurrent access
    cursor = conn.cursor()
    print("Initializing database...")
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS shares (
            share_code TEXT PRIMARY KEY,
            created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
            expires_at INTEGER DEFAULT (CAST(strftime('%s', 'now', '+24 hours') AS INTEGER))
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            sid TEXT PRIMARY KEY,        
            share_code TEXT NOT NULL,    
            username TEXT NOT NULL,         
            color TEXT NOT NULL,         
            lat REAL,
            lon REAL,
            heading REAL,
            last_update INTEGER,         
            FOREIGN KEY(share_code) REFERENCES shares(share_code) ON DELETE CASCADE
        )
    ''')
    
    # Add indexes for better performance
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_share_code ON users(share_code)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_users_last_update ON users(last_update)')
    
    conn.commit()
    conn.close()
    print("Database initialized with foreign keys and WAL mode enabled.")

# --- Helper Functions (Database Aware) ---

def validate_share_code(share_code):
    """Validates share code format and sanitizes input."""
    if not share_code or not isinstance(share_code, str):
        return None
    
    # Remove whitespace and convert to uppercase
    code = share_code.strip().upper()
    
    # Validate format: exactly 3 letters, dash, 3 digits (ABC-123)
    if not re.match(r'^[A-Z]{3}-[0-9]{3}$', code):
        return None
    
    return code

def generate_easy_code(length=6):
    """Generates a simple, memorable code and ensures it's unique in the DB."""
    chars = string.ascii_uppercase
    digits = string.digits
    db = get_db()
    cursor = db.cursor()

    while True:
        if length != 6:
            code = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(length))
        else:
            part1 = ''.join(random.choice(chars) for _ in range(3))
            part2 = ''.join(random.choice(digits) for _ in range(3))
            code = f"{part1}-{part2}"

        cursor.execute('SELECT 1 FROM shares WHERE share_code = ?', (code,))
        if cursor.fetchone() is None:
            return code

def get_next_color(share_code):
    """Assigns the next available color based on users currently in the DB for this share."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT COUNT(*) FROM users WHERE share_code = ?', (share_code,))
    count = cursor.fetchone()[0]
    return USER_COLORS[count % len(USER_COLORS)]

def get_user_details(sid):
    """Retrieves user details (share_code, color) from the database."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT share_code, color, username FROM users WHERE sid = ?', (sid,))
    return cursor.fetchone() 

def _get_users_in_share(share_code):
    """Helper to get active users in a specific share."""
    conn = get_db()
    cursor = conn.execute(
        "SELECT sid, username, color, lat, lon, heading FROM users WHERE share_code = ?",
        (share_code,)
    )
    # Include username in the returned data
    users = [{'sid': row[0], 'username': row[1], 'color': row[2], 'lat': row[3], 'lon': row[4], 'heading': row[5]}
             for row in cursor.fetchall()]
    return users

def emit_user_list_update(share_code):
    """Helper function to fetch and emit the current user list for a share."""
    print(f"Emitting user list update for share: {share_code}")
    users_in_share = _get_users_in_share(share_code) # Fetches sid, username, color, etc.
    socketio.emit('user_list_update', {'users': users_in_share}, room=share_code)

def cleanup_expired_shares():
    """Remove expired shares and their associated users."""
    try:
        db = get_db()
        cursor = db.cursor()
        current_time = int(time.time())
        
        # Find expired shares
        cursor.execute('SELECT share_code FROM shares WHERE expires_at < ?', (current_time,))
        expired_shares = cursor.fetchall()
        
        if expired_shares:
            expired_codes = [share['share_code'] for share in expired_shares]
            logger.info(f"Cleaning up {len(expired_codes)} expired shares: {expired_codes}")
            
            # Delete expired shares (users will be deleted via CASCADE)
            cursor.execute('DELETE FROM shares WHERE expires_at < ?', (current_time,))
            db.commit()
            
            return len(expired_codes)
        return 0
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        return 0

# --- Routes ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/offline.html')
def offline():
    """Serves the offline page for PWA."""
    return render_template('offline.html')

# --- SocketIO Events (Database Aware) ---

@socketio.on('connect')
def handle_connect():
    """Handles a new client connection. No DB action needed until they join/create."""
    print(f'Client connected: {request.sid}')

    # Simple default username generation
    username = f"User-{request.sid[:4]}"
    print(f"Assigning username: {username} to SID: {request.sid}")

    # Add user to DB
    conn = get_db()
    try:
        conn.execute("INSERT INTO users (sid, username) VALUES (?, ?)",
                     (request.sid, username))
        conn.commit()
    except sqlite3.IntegrityError:
        # User might already exist if they reconnected quickly
        conn.execute("UPDATE users SET username = ? WHERE sid = ?",
                     (username, request.sid))
        conn.commit()
        print(f"Updated existing user {request.sid} in DB")
    except Exception as e:
        conn.rollback()
        print(f"Database error adding user {request.sid}: {e}")
        # Handle error appropriately, maybe disconnect user or send error message
        return # Or raise an error

@socketio.on('disconnect')
def handle_disconnect():
    """Handles a client disconnection. Remove user from DB and notify room."""
    sid = request.sid
    print(f'Client disconnecting: {sid}')

    with app.app_context(): 
        db = get_db()
        cursor = db.cursor()

        cursor.execute('SELECT share_code FROM users WHERE sid = ?', (sid,))
        result = cursor.fetchone()

        if result:
            share_code = result['share_code']
            print(f'User {sid} was in share {share_code}. Removing from DB.')

            cursor.execute('DELETE FROM users WHERE sid = ?', (sid,))
            db.commit()

            emit('user_left', {'sid': sid}, room=share_code)

            cursor.execute('SELECT COUNT(*) FROM users WHERE share_code = ?', (share_code,))
            user_count = cursor.fetchone()[0]
            if user_count == 0:
                print(f'Share {share_code} is now empty. Removing from shares table.')
                cursor.execute('DELETE FROM shares WHERE share_code = ?', (share_code,))
                db.commit()
            else:
                emit_user_list_update(share_code)
        else:
            print(f'Disconnecting user {sid} was not found in any active share.')

@socketio.on('create_share')
def handle_create_share():
    """Generates a new share code, saves to DB, joins the user, returns the code."""
    user_sid = request.sid
    with app.app_context():
        db = get_db()
        cursor = db.cursor()

        share_code = generate_easy_code()
        color = get_next_color(share_code) 
        current_time = int(time.time())
        default_username = f"User-{user_sid[:4]}"

        try:
            cursor.execute('INSERT INTO shares (share_code, created_at) VALUES (?, ?)', (share_code, current_time))
            cursor.execute('''
                INSERT INTO users (sid, share_code, color, username, last_update)
                VALUES (?, ?, ?, ?, ?)
            ''', (user_sid, share_code, color, default_username, current_time))
            db.commit()

            join_room(share_code) 
            print(f'User {user_sid} ({default_username}) created share {share_code} and was added to DB.')
            emit('share_created', {'share_code': share_code, 'sid': user_sid, 'color': color, 'username': default_username})
            emit_user_list_update(share_code)

        except sqlite3.Error as e:
            db.rollback()
            print(f"Database error on create_share: {e}")
            emit('create_error', {'message': 'Failed to create share due to a database error.'})


@socketio.on('join_share')
def handle_join_share(data):
    """Joins a user to an existing share code room if it exists in the DB."""
    share_code_input = data.get('share_code')
    user_sid = request.sid

    if not share_code_input:
        emit('join_error', {'message': 'Share code cannot be empty.'})
        return

    share_code = validate_share_code(share_code_input)
    if not share_code:
        emit('join_error', {'message': 'Invalid share code format. Please use format ABC-123.'})
        return

    with app.app_context():
        db = get_db()
        cursor = db.cursor()

        cursor.execute('SELECT 1 FROM shares WHERE share_code = ?', (share_code,))
        if cursor.fetchone():
            try:
                default_username = f"User-{user_sid[:4]}"
                color = get_next_color(share_code)
                current_time = int(time.time())
                cursor.execute('''
                    INSERT INTO users (sid, share_code, color, username, last_update)
                    VALUES (?, ?, ?, ?, ?)
                ''', (user_sid, share_code, color, default_username, current_time))
                db.commit()

                join_room(share_code) 
                logger.info(f'User {user_sid} ({default_username}) joined share {share_code}')
                emit('joined_share', {'share_code': share_code, 'sid': user_sid, 'color': color, 'username': default_username})

                cursor.execute('''
                    SELECT sid, username, lat, lon, heading, color FROM users
                    WHERE share_code = ? AND sid != ? AND lat IS NOT NULL
                ''', (share_code, user_sid))
                existing_users = cursor.fetchall()
                existing_users_data = {row['sid']: {'username': row['username'], 'lat': row['lat'], 'lon': row['lon'], 'heading': row['heading'], 'color': row['color']} for row in existing_users}

                if existing_users_data:
                    logger.info(f"Sending existing user data to {user_sid}: {len(existing_users_data)} users")
                    emit('existing_users', {'users': existing_users_data})

                new_user_data = {'lat': None, 'lon': None, 'heading': None, 'color': color, 'username': default_username}
                logger.info(f"Notifying room {share_code} of new user {user_sid}")
                emit('user_joined', {'sid': user_sid, 'data': new_user_data}, room=share_code, skip_sid=user_sid)

                emit_user_list_update(share_code)

            except sqlite3.IntegrityError: 
                 db.rollback()
                 logger.warning(f"User {user_sid} might already exist in share {share_code}. Allowing join anyway.")
                 join_room(share_code)
                 user_details = get_user_details(user_sid)
                 if user_details:
                     emit('joined_share', {'share_code': user_details['share_code'], 'sid': user_sid, 'color': user_details['color'], 'username': user_details['username']})
                     emit_user_list_update(user_details['share_code'])
                 else: 
                     emit('join_error', {'message': 'Error re-joining share.'})

            except sqlite3.Error as e:
                db.rollback()
                logger.error(f"Database error on join_share: {e}")
                emit('join_error', {'message': 'Failed to join share due to a database error.'})
        else:
            logger.warning(f'User {user_sid} failed to join non-existent share {share_code}')
            emit('join_error', {'message': f'Share code "{share_code}" not found.'})

@socketio.on('location_update')
def handle_location_update(data):
    """Receives location update, updates DB, and broadcasts to room."""
    user_sid = request.sid
    lat = data.get('lat')
    lon = data.get('lon')
    heading = data.get('heading')

    if lat is None or lon is None:
        return

    with app.app_context():
        db = get_db()
        cursor = db.cursor()

        cursor.execute('SELECT share_code, color FROM users WHERE sid = ?', (user_sid,))
        user_info = cursor.fetchone()

        if user_info:
            share_code = user_info['share_code']
            color = user_info['color']
            current_time = int(time.time())

            try:
                cursor.execute('''
                    UPDATE users SET lat = ?, lon = ?, heading = ?, last_update = ?
                    WHERE sid = ?
                ''', (lat, lon, heading, current_time, user_sid))
                db.commit()

                user_details = get_user_details(user_sid)
                broadcast_data = {
                    'sid': user_sid,
                    'lat': lat,
                    'lon': lon,
                    'heading': heading,
                    'color': color,
                    'username': user_details['username']
                }

                emit('location_broadcast', broadcast_data, room=share_code, skip_sid=user_sid)

            except sqlite3.Error as e:
                db.rollback()
                print(f"Database error on location_update for {user_sid}: {e}")

        else:
            print(f'Received location update from user {user_sid} not found in DB.')

# --- Main Execution ---
if __name__ == '__main__':
    init_db() 
    print("Starting Flask-SocketIO server...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
