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

// Function to send email notification
async function sendNotification(subject, message) {
    try {
        console.log('Attempting to send email notification...');
        console.log('Email details:', {
            from: process.env.SMTP_USERNAME,
            to: process.env.NOTIFICATION_EMAIL,
            subject: subject,
            message: message
        });
        
        const mailOptions = {
            from: process.env.SMTP_USERNAME,
            to: process.env.NOTIFICATION_EMAIL,
            subject: subject,
            text: message,
            html: `<p>${message.replace(/\n/g, '<br>')}</p>` // Add HTML version for better formatting
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email notification sent successfully:', {
            messageId: info.messageId,
            response: info.response
        });
        return true;
    } catch (error) {
        console.error('Error sending email notification:', {
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
        if (view.ticketCount >= 5) {
            await sendNotification(
                `Zendesk Queue Alert: High Ticket Volume in ${view.viewName}`,
                `Alert: The view "${view.viewName}" currently has ${view.ticketCount} tickets.`
            );
        }

        if (view.hasOfficeDown) {
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
            if (view.ticketCount >= 5) {
                const emailSent = await sendNotification(
                    `Zendesk Queue Alert: High Ticket Volume in ${view.viewName}`,
                    `Alert: The view "${view.viewName}" currently has ${view.ticketCount} tickets.`
                );
                if (emailSent) notificationsSent = true;
            }

            if (view.hasOfficeDown) {
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

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 