# filepath: /Users/maneet/Documents/gissen/work/go2labs/2LabsToGo-Eco/2LabsToGo-Eco-Software/app/Dockerfile
# Use the existing base image
FROM ocmanager/ocmanager4:arm64

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt /app/requirements.txt

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app code
COPY . /app

# Expose the port Django will run on
EXPOSE 8000

# Default command to run the Django app
CMD ["sh", "-c", "python manage.py makemigrations && python manage.py migrate && python manage.py runserver 0.0.0.0:8000"]