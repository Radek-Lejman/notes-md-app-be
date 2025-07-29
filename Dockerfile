# Używamy Node.js 20 jako bazowego obrazu
FROM node:20

# Ustaw katalog roboczy
WORKDIR /app

# Skopiuj pliki package.json i package-lock.json
COPY package*.json ./

# Zainstaluj zależności
RUN npm ci

# Skopiuj resztę kodu aplikacji
COPY . .

# Otwórz port aplikacji (np. 3000)
EXPOSE 3000

# Komenda startowa
CMD ["npm", "run", "start:dev"]