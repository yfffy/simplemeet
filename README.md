# Simple Meet

A simple web application to share and view real-time locations using a shared code.

## Features

*   Generate a unique, easy-to-type share code.
*   Join an existing share group using a code.
*   View participants' locations in real-time on OpenStreetMap.
*   Different colors for each participant.
*   Direction indicator (if available from device).

## Tech Stack

*   **Backend:** Python, Flask, Flask-SocketIO, SQLite
*   **Frontend:** HTML, CSS, JavaScript, Leaflet.js, Socket.IO Client

## Setup

### Running Locally

1.  Clone the repository.
2.  Create a virtual environment:
    ```bash
    python -m venv venv
    source venv/bin/activate # Linux/macOS
    .\venv\Scripts\activate # Windows
    ```
3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4.  Run the application:
    ```bash
    # The server will run on http://127.0.0.1:5000 by default
    python app.py 
    ```
5.  Open your browser and navigate to `http://127.0.0.1:5000`.

### Running with Docker

1.  Ensure Docker and Docker Compose are installed.
2.  Navigate to the project directory in your terminal.
3.  Build and run the container:
    ```bash
    docker compose up --build -d
    ```
4.  Open your browser and navigate to `http://localhost:5000`.
5.  To stop the container:
    ```bash
    docker compose down
    ```
