AIPowerSalon Website — Upload Instructions
=============================================

WHAT'S IN THIS FOLDER
  index.html            the website page
  assets/css/styles.css all styling
  assets/js/main.js     menu, forms, FAQ, animations
  assets/img/           all 12 website images

HOW TO UPLOAD (Hetzner + nginx)
  Upload the WHOLE folder contents (keeping the same structure) into:
      /var/www/aipowersalon/
  so the server has:
      /var/www/aipowersalon/index.html
      /var/www/aipowersalon/assets/...

  Example from your computer (run inside this folder):
      scp -r index.html assets root@SERVER_IP:/var/www/aipowersalon/

IMPORTANT
  - Keep the folder structure exactly as-is. index.html loads
    assets/css, assets/js and assets/img by relative path.
  - Forms: submissions are delivered by email — the visitor's email
    app opens pre-filled to nailsalon@aipowersalon.com and they press Send.
    When the backend API is live, set API_BASE in assets/js/main.js
    and submissions will save directly instead.
  - To update an image later, replace the file in assets/img/ keeping
    the same filename.
