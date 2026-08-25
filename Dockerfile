# syntax=docker/dockerfile:1

# ---- Base image ----
# Ubuntu 22.04 is used (not python:slim/Debian) because SUMO's official PPA
# targets Ubuntu, giving a much newer/more reliable SUMO build than what's
# packaged for Debian.
FROM ubuntu:22.04

# Avoid interactive tzdata/apt prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# ---- System dependencies + SUMO ----
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        curl \
        git \
        build-essential \
    && add-apt-repository -y ppa:sumo/stable \
    && apt-get update && apt-get install -y --no-install-recommends \
        sumo \
        sumo-tools \
        sumo-doc \
        python3.10 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

# ---- SUMO environment variables ----
# SUMO_HOME is required by TraCI/sumolib to locate SUMO's bundled tools.
ENV SUMO_HOME=/usr/share/sumo
ENV PATH="${SUMO_HOME}/bin:${PATH}"
ENV PYTHONPATH="${SUMO_HOME}/tools:${PYTHONPATH}"

# ---- Python dependencies ----
WORKDIR /app

# Copy only the requirements file first so Docker can cache this layer
# and skip reinstalling everything when only source code changes.
COPY requirements.txt .

RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r requirements.txt

# ---- Project source ----
# In local dev, this gets overridden by the compose.yml volume mount so
# code changes on the host are reflected instantly without rebuilding.
COPY . .

# ---- Verification step (fails the build early if SUMO/TraCI is broken) ----
RUN python3 -c "import traci, sumolib; print('TraCI/sumolib import OK')" \
    && sumo --version

# Headless by default: no GUI dependencies are installed (sumo-gui is
# intentionally excluded — this image is for training/evaluation, not
# visual inspection). Use the host's SUMO/sumo-gui for that instead.

CMD ["/bin/bash"]
