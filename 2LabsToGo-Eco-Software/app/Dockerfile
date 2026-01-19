FROM ocmanager/ocmanager4:arm64

ENV DEBIAN_FRONTEND=noninteractive

# 1. Prevent libc-bin from being upgraded to avoid QEMU segfaults
# 2. Update and install libs
# 3. Clean up
RUN apt-mark hold libc-bin && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

EXPOSE 8000

CMD ["sh", "-c", "python manage.py makemigrations && python manage.py migrate && python manage.py runserver 0.0.0.0:8000"]