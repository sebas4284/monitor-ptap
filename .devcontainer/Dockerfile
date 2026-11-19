FROM node:26.12.1-bookworm@sha256:3b764117159bda01d2396391e7789b6a9106af9729cfd001ef55e98557868310

USER root
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends iputils-ping libcap2-bin \
    && if getcap /usr/bin/ping | grep -q .; then setcap -r /usr/bin/ping; fi \
    && rm -rf /var/lib/apt/lists/*

USER node
