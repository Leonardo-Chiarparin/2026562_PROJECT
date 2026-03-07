# Use the official Nginx image as the base
FROM nginx:alpine

# 1. Copy the content of your 'html' folder directly to the root
COPY ./html/index.html /usr/share/nginx/html/index.html

# 2. Copy the assets folders (css, js) into the root
COPY ./css /usr/share/nginx/html/css
COPY ./js /usr/share/nginx/html/js

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]