require('dotenv').config();
const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Email transporter setup
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_SERVER,
    port: process.env.SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD
    },
    debug: true, // Enable debug logging
    logger: true // Enable logger
});

// Verify email configuration
transporter.verify(function(error, success) {
    if (error) {
        console.error('Email configuration error:', error);
    } else {
        console.log('Email server is ready to send messages');
        console.log('SMTP Configuration:', {
            host: process.env.SMTP_SERVER,
            port: process.env.SMTP_PORT,
            user: process.env.SMTP_USERNAME,
            recipient: process.env.NOTIFICATION_EMAIL
        });
    }
});

// Telegram configuration
const TELEGRAM_BOT_TOKEN = '7260610988:AAEesoIcYxxde7QSH4-kb4FHuL5TBq51Hx4';
const TELEGRAM_CHAT_ID = '-4748043895';

// Zendesk API configuration
const zendeskConfig = {
    subdomain: process.env.ZENDESK_SUBDOMAIN,
    email: process.env.ZENDESK_EMAIL,
    token: process.env.ZENDESK_API_TOKEN,
    viewIds: process.env.ZENDESK_VIEW_IDS ? process.env.ZENDESK_VIEW_IDS.split(',') : []
};

// Function to check Zendesk views
async function checkZendeskViews() {
    try {
        const viewResults = [];
        
        // Use the specific field ID for office down
        const officeDownFieldId = '31823557691671';
        
        for (const viewId of zendeskConfig.viewIds) {
            const response = await axios.get(
                `https://${zendeskConfig.subdomain}.zendesk.com/api/v2/views/${viewId}/tickets.json`,
                {
                    auth: {
                        username: `${zendeskConfig.email}/token`,
                        password: zendeskConfig.token
                    }
                }
            );

            const tickets = response.data.tickets;
            const ticketCount = tickets.length;
            
            // Debug: Log all tickets and their custom fields
            console.log('All tickets in view:', viewId);
            tickets.forEach(ticket => {
                const officeDownField = ticket.custom_fields.find(field => field.id.toString() === officeDownFieldId);
                console.log(`Ticket #${ticket.id}:`, {
                    subject: ticket.subject,
                    office_down_value: officeDownField ? officeDownField.value : 'not found'
                });
            });
            
            const officeDownTickets = tickets.filter(ticket => {
                const officeDownField = ticket.custom_fields.find(field => field.id.toString() === officeDownFieldId);
                const isOfficeDown = officeDownField && officeDownField.value === true;
                if (isOfficeDown) {
                    console.log(`Found office down ticket: #${ticket.id}`, {
                        subject: ticket.subject,
                        office_down_value: officeDownField.value
                    });
                }
                return isOfficeDown;
            });

            // Get view details
            const viewResponse = await axios.get(
                `https://${zendeskConfig.subdomain}.zendesk.com/api/v2/views/${viewId}.json`,
                {
                    auth: {
                        username: `${zendeskConfig.email}/token`,
                        password: zendeskConfig.token
                    }
                }
            );

            viewResults.push({
                viewId,
                viewName: viewResponse.data.view.title,
                ticketCount,
                hasOfficeDown: officeDownTickets.length > 0,
                officeDownTickets: officeDownTickets.map(ticket => ({
                    id: ticket.id,
                    subject: ticket.subject
                }))
            });
        }

        return viewResults;
    } catch (error) {
        console.error('Error checking Zendesk views:', error);
        return null;
    }
}

// Function to send Telegram notification
async function sendTelegramNotification(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        console.log('\n=== TELEGRAM NOTIFICATION ATTEMPT ===');
        console.log('URL:', url);
        console.log('Chat ID:', TELEGRAM_CHAT_ID);
        console.log('Message:', message);
        console.log('Token length:', TELEGRAM_BOT_TOKEN.length);
        console.log('=====================================\n');
        
        const response = await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        
        console.log('\n=== TELEGRAM API RESPONSE ===');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('=============================\n');
        return true;
    } catch (error) {
        console.error('\n=== TELEGRAM ERROR ===');
        console.error('Error message:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Status code:', error.response.status);
        }
        console.error('========================\n');
        return false;
    }
}

// Function to send notification (modified to include Telegram)
async function sendNotification(subject, message) {
    try {
        console.log('Attempting to send notifications...');
        
        // Send email notification
        const mailOptions = {
            from: process.env.SMTP_USERNAME,
            to: process.env.NOTIFICATION_EMAIL,
            subject: subject,
            text: message,
            html: `<p>${message.replace(/\n/g, '<br>')}</p>`
        };

        const emailInfo = await transporter.sendMail(mailOptions);
        console.log('Email notification sent successfully:', {
            messageId: emailInfo.messageId,
            response: emailInfo.response
        });

        // Send Telegram notification
        console.log('Preparing to send Telegram notification...');
        const telegramMessage = `*${subject}*\n${message}`;
        const telegramSent = await sendTelegramNotification(telegramMessage);
        console.log('Telegram notification result:', telegramSent);

        return true;
    } catch (error) {
        console.error('Error sending notifications:', {
            error: error.message,
            stack: error.stack,
            code: error.code
        });
        return false;
    }
}

// Scheduled check every 5 minutes from 8 AM to 6 PM CST (14:00 to 00:00 UTC), 7 days a week
cron.schedule('*/5 14-23 * * *', async () => {
    console.log('Running scheduled check...');
    const viewResults = await checkZendeskViews();
    if (!viewResults) return;

    for (const view of viewResults) {
        console.log(`Checking view "${view.viewName}":`, {
            ticketCount: view.ticketCount,
            hasOfficeDown: view.hasOfficeDown
        });

        if (view.ticketCount >= 35) {  // Changed back to 35
            console.log('High ticket volume detected, sending notifications...');
            await sendNotification(
                `Zendesk Queue Alert: High Ticket Volume in ${view.viewName}`,
                `Alert: The view "${view.viewName}" currently has ${view.ticketCount} tickets.`
            );
        }

        if (view.hasOfficeDown) {
            console.log('Office down ticket detected, sending notifications...');
            await sendNotification(
                `Zendesk Queue Alert: Office Down Ticket Detected in ${view.viewName}`,
                `Alert: A ticket with "Is Your Office Down?" field checked has been detected in view "${view.viewName}".`
            );
        }
    }
});

// Routes
app.get('/', async (req, res) => {
    const viewResults = await checkZendeskViews();
    res.render('index', { 
        viewResults,
        lastChecked: new Date().toLocaleString()
    });
});

app.post('/scan', async (req, res) => {
    try {
        const viewResults = await checkZendeskViews();
        if (!viewResults) {
            return res.status(500).json({ error: 'Failed to scan views' });
        }
        
        let notificationsSent = false;
        
        // Check conditions and send notifications if needed
        for (const view of viewResults) {
            console.log(`Manual scan - Checking view "${view.viewName}":`, {
                ticketCount: view.ticketCount,
                hasOfficeDown: view.hasOfficeDown
            });

            if (view.ticketCount >= 35) {  // Changed back to 35
                console.log('High ticket volume detected, sending notifications...');
                const emailSent = await sendNotification(
                    `Zendesk Queue Alert: High Ticket Volume in ${view.viewName}`,
                    `Alert: The view "${view.viewName}" currently has ${view.ticketCount} tickets.`
                );
                if (emailSent) notificationsSent = true;
            }

            if (view.hasOfficeDown) {
                console.log('Office down ticket detected, sending notifications...');
                const emailSent = await sendNotification(
                    `Zendesk Queue Alert: Office Down Ticket Detected in ${view.viewName}`,
                    `Alert: A ticket with "Is Your Office Down?" field checked has been detected in view "${view.viewName}".`
                );
                if (emailSent) notificationsSent = true;
            }
        }
        
        res.json({
            viewResults,
            lastChecked: new Date().toISOString(),
            message: 'Scan completed successfully',
            notificationsSent
        });
    } catch (error) {
        console.error('Error in scan route:', error);
        res.status(500).json({ error: 'Internal server error during scan' });
    }
});

app.get('/api/status', async (req, res) => {
    const viewResults = await checkZendeskViews();
    res.json({
        viewResults,
        lastChecked: new Date().toISOString()
    });
});

// Add test route for Telegram
app.get('/test-telegram', async (req, res) => {
    try {
        const testMessage = '*Test Notification*\nThis is a test message from your Zendesk Queue Notifier.';
        const success = await sendTelegramNotification(testMessage);
        
        if (success) {
            res.json({ success: true, message: 'Test notification sent successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to send test notification' });
        }
    } catch (error) {
        console.error('Error in test-telegram route:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 