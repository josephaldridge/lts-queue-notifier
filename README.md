# Zendesk Queue Notifier Web App

A web application that monitors your Zendesk ticket queue and sends email notifications when:
1. The number of tickets in the queue reaches 5 or more
2. A ticket with the "Is Your Office Down?" field checked is detected

## Features

- Real-time monitoring of Zendesk queue
- Web interface to view current status
- Email notifications for important events
- Auto-refreshing dashboard
- Responsive design

## Setup Instructions

1. Install Node.js and npm on your system

2. Install the required dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root with the following variables:
   ```
   PORT=3000
   ZENDESK_SUBDOMAIN=your_subdomain
   ZENDESK_EMAIL=your_email
   ZENDESK_API_TOKEN=your_api_token
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your_email@gmail.com
   SMTP_PASSWORD=your_app_password
   NOTIFICATION_EMAIL=recipient@example.com
   ```

4. For Gmail users:
   - You'll need to use an App Password instead of your regular password
   - Go to your Google Account settings
   - Enable 2-Step Verification if not already enabled
   - Generate an App Password for this application

5. For Zendesk:
   - Create an API token in your Zendesk account
   - Make sure you have the necessary permissions to view tickets

## Running the Application

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Deployment Options

This application can be deployed to various platforms:

1. **Heroku** (Free tier available):
   ```bash
   heroku create
   git push heroku main
   ```

2. **Render** (Free tier available):
   - Connect your GitHub repository
   - Set up the environment variables
   - Deploy

3. **Railway** (Free tier available):
   - Connect your GitHub repository
   - Set up the environment variables
   - Deploy

## Customization

You can modify the following in the code:
- The ticket threshold (currently set to 5)
- The check interval (currently set to 5 minutes)
- The email notification format
- The web interface design

## Troubleshooting

If you encounter any issues:
1. Verify all environment variables are set correctly
2. Check your Zendesk API token permissions
3. Ensure your email credentials are correct
4. Check your network connection to both Zendesk and the SMTP server
5. Check the application logs for any error messages 