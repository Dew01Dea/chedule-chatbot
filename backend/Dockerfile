# PDFs are rasterized with poppler's pdftoppm where it is installed, and with
# pdf.js (an npm dependency) otherwise. poppler is installed here because it
# resolves fonts a PDF does not embed through the system's font configuration,
# which pdf.js cannot — so a container gets the more faithful of the two.
# Node 22.13+ is what pdfjs-dist requires.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies are copied on their own so a change to application code does not
# invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Hosts that inject a PORT (Render, Railway, Fly) override this; server.js
# reads process.env.PORT and falls back to the same number.
ENV PORT=4000
EXPOSE 4000

# Drop privileges: nothing here writes to the image, and uploads are held in
# memory and rasterized under the OS temp directory.
USER node

CMD ["node", "server.js"]
