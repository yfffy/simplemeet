# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# Use --no-cache-dir to reduce image size
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container at /app
COPY . .

# Make port 5000 available to the world outside this container
# Note: We'll run the app on this port inside the container
EXPOSE 5000

# Define environment variable (optional, can also be set in docker-compose)
# ENV NAME World

# Command to run the application using eventlet
# Bind to 0.0.0.0 to accept connections from outside the container
# Use the desired port 5000
CMD ["python", "-m", "eventlet.wsgi", "-p", "5000", "--host", "0.0.0.0", "app:app"]
