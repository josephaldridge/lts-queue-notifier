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

// Financial Products Telegram configuration
const FINANCIAL_TELEGRAM_BOT_TOKEN = process.env.FINANCIAL_TELEGRAM_BOT_TOKEN;
const FINANCIAL_TELEGRAM_CHAT_ID = process.env.FINANCIAL_TELEGRAM_CHAT_ID;

// Zendesk API configuration
const zendeskConfig = {
    subdomain: process.env.ZENDESK_SUBDOMAIN,
    email: process.env.ZENDESK_EMAIL,
    token: process.env.ZENDESK_API_TOKEN,
    viewIds: process.env.ZENDESK_VIEW_IDS ? process.env.ZENDESK_VIEW_IDS.split(',') : []
};

// Financial Products Support views (now from .env)
const FINANCIAL_VIEW_IDS = process.env.FINANCIAL_VIEW_IDS ? process.env.FINANCIAL_VIEW_IDS.split(',') : [];
const FINANCIAL_VIEWS = FINANCIAL_VIEW_IDS.map(id => ({ id: id.trim(), name: `View ${id.trim()}` }));

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

// Function to send Telegram notification (generic, accepts bot token and chat id)
async function sendTelegramNotification(message, botToken = TELEGRAM_BOT_TOKEN, chatId = TELEGRAM_CHAT_ID) {
    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        console.log('\n=== TELEGRAM NOTIFICATION ATTEMPT ===');
        console.log('URL:', url);
        console.log('Chat ID:', chatId);
        console.log('Message:', message);
        console.log('Token length:', botToken.length);
        console.log('=====================================\n');
        
        const response = await axios.post(url, {
            chat_id: chatId,
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

        // Send Telegram notification with markdown formatting
        console.log('Preparing to send Telegram notification...');
        // Convert the message to include markdown links for tickets
        const telegramMessage = message.replace(
            /^- (.*?)\n  (https:\/\/.*?)$/gm,
            '- [$1]($2)'
        );
        console.log('Formatted Telegram message:', telegramMessage);
        const formattedTelegramMessage = `*${subject}*\n${telegramMessage}`;
        const telegramSent = await sendTelegramNotification(formattedTelegramMessage);
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

app.get('/scan', async (req, res) => {
    console.log('\n=== MANUAL SCAN STARTED ===');
    try {
        console.log('Fetching Zendesk views...');
        const viewResults = await checkZendeskViews();
        if (!viewResults) {
            console.error('Failed to fetch Zendesk views');
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch Zendesk views',
                details: 'The checkZendeskViews function returned null'
            });
        }
        
        console.log(`Found ${viewResults.length} views`);
        const viewCounts = {};
        let hasOfficeDown = false;
        let officeDownTickets = [];

        for (const view of viewResults) {
            console.log(`\nChecking view: ${view.viewName}`);
            viewCounts[view.viewName] = view.ticketCount;
            console.log(`Count for ${view.viewName}: ${view.ticketCount}`);

            if (view.ticketCount >= 35) {
                console.log(`⚠️ High volume alert: ${view.viewName} has ${view.ticketCount} tickets`);
            }

            if (view.hasOfficeDown) {
                console.log(`⚠️ Office Down found in view ${view.viewName}`);
                hasOfficeDown = true;
                officeDownTickets.push(...view.officeDownTickets.map(ticket => ({
                    ...ticket,
                    url: `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${ticket.id}`
                })));
            }
        }

        console.log('\n=== SCAN RESULTS ===');
        console.log('View Counts:', viewCounts);
        console.log('Has Office Down:', hasOfficeDown);
        if (officeDownTickets.length > 0) {
            console.log('Office Down Tickets:', officeDownTickets);
        }

        // Check for high volume
        const highVolumeViews = Object.entries(viewCounts)
            .filter(([_, count]) => count >= 35)
            .map(([name, count]) => ({ name, count }));

        if (highVolumeViews.length > 0 || hasOfficeDown) {
            console.log('\n=== SENDING NOTIFICATIONS ===');
            let message = '';
            
            if (highVolumeViews.length > 0) {
                message += 'High volume alert:\n';
                highVolumeViews.forEach(({ name, count }) => {
                    message += `- ${name}: ${count} tickets\n`;
                });
            }
            
            if (hasOfficeDown) {
                message += '\nOffice Down Alert:\n';
                officeDownTickets.forEach(ticket => {
                    message += `- ${ticket.subject}\n  https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${ticket.id}\n`;
                });
            }

            console.log('Sending notifications with message:', message);
            await sendNotification('LTS Queue Alert', message);
        } else {
            console.log('No alerts to send - all views under threshold and no office down tickets');
        }

        res.json({ 
            success: true, 
            viewCounts, 
            hasOfficeDown, 
            officeDownTickets,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error during manual scan:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
    console.log('=== MANUAL SCAN COMPLETED ===\n');
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
        const testMessage = 'Testing ticket link format:\n' +
            '- Test Office Down Ticket\n' +
            `  https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/615595`;
        const success = await sendNotification('Test Alert', testMessage);
        
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

// Add new route for Financial Products Support page
app.get('/financial', async (req, res) => {
    try {
        const viewResults = await checkFinancialViews();
        res.render('financial', { 
            viewResults,
            lastChecked: new Date().toLocaleString(),
            process: process
        });
    } catch (error) {
        console.error('Error rendering financial page:', error);
        res.status(500).send('Error loading page');
    }
});

// Add new scan route for Financial Products Support
app.get('/scan/financial', async (req, res) => {
    try {
        const viewResults = await checkFinancialViews();
        res.json({ 
            success: true, 
            viewResults,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error scanning financial views:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
});

// Function to check Financial Products Support views
async function checkFinancialViews() {
    const results = [];
    
    for (const view of FINANCIAL_VIEWS) {
        try {
            const response = await axios.get(
                `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/views/${view.id}/tickets.json`,
                {
                    auth: {
                        username: `${process.env.ZENDESK_EMAIL}/token`,
                        password: process.env.ZENDESK_API_TOKEN
                    }
                }
            );

            const ticketCount = response.data.tickets.length;

            // Try to get the view name from the API if not set
            let viewName = view.name;
            try {
                const viewDetails = await axios.get(
                    `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/views/${view.id}.json`,
                    {
                        auth: {
                            username: `${process.env.ZENDESK_EMAIL}/token`,
                            password: process.env.ZENDESK_API_TOKEN
                        }
                    }
                );
                viewName = viewDetails.data.view.title;
            } catch (e) {
                // fallback to default name
            }

            results.push({
                viewId: view.id,
                viewName: viewName,
                ticketCount: ticketCount
            });

            // Send notification if ticket count is 11 or more
            if (ticketCount >= 11) {
                const subject = `High Ticket Volume Alert - ${viewName}`;
                const message = `The ${viewName} queue currently has ${ticketCount} tickets. Please check the queue at https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/agent/filters/${view.id}`;
                
                // Send email notification
                await sendEmailNotification(
                    'Laniann.walker@libtax.com',
                    subject,
                    message
                );
                // Send Telegram notification using the Financial Products bot
                await sendTelegramNotification(`*${subject}*\n${message}`, FINANCIAL_TELEGRAM_BOT_TOKEN, FINANCIAL_TELEGRAM_CHAT_ID);
            }
        } catch (error) {
            console.error(`Error checking view ${view.id}:`, error);
            results.push({
                viewId: view.id,
                viewName: view.name,
                error: error.message
            });
        }
    }
    
    return results;
}

// Function to send email notifications
async function sendEmailNotification(to, subject, message) {
    try {
        const mailOptions = {
            from: process.env.SMTP_USERNAME,
            to: to,
            subject: subject,
            text: message,
            html: `<p>${message.replace(/\n/g, '<br>')}</p>`
        };

        const emailInfo = await transporter.sendMail(mailOptions);
        console.log(`Email notification sent to ${to}:`, {
            messageId: emailInfo.messageId,
            response: emailInfo.response
        });
    } catch (error) {
        console.error('Error sending email notification:', error);
    }
}

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 