FROM node:18-alpine
WORKDIR /usr/src/app

# Install production dependencies
COPY package*.json ./
RUN npm install

# Copy code + env
COPY . .

# Expose the port your app uses (e.g. 5000)
EXPOSE 8080

CMD ["npm", "start"]