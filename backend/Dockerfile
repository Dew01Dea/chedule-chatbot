# The OCR pipeline shells out to poppler's pdftoppm to rasterize each PDF page
# before sending it to Typhoon, so the image needs poppler-utils present. This
# is the reason the backend is not deployed as serverless functions: that
# binary cannot be installed into a Vercel function.
FROM node:20-bookworm-slim

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
