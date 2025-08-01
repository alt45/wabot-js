# Gunakan base image Node.js versi LTS
FROM node:20-slim

# Tentukan direktori kerja di dalam container
WORKDIR /usr/src/app

# Salin package.json dan package-lock.json
COPY package*.json ./

# Install dependensi
RUN npm install

# Salin semua file proyek ke direktori kerja
COPY . .

# Perintah untuk menjalankan aplikasi
CMD [ "npm", "start" ]
