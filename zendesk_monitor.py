import os
import requests
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
import schedule
import time

# Load environment variables
load_dotenv()

class ZendeskMonitor:
    def __init__(self):
        self.subdomain = os.getenv('ZENDESK_SUBDOMAIN')
        self.email = os.getenv('ZENDESK_EMAIL')
        self.api_token = os.getenv('ZENDESK_API_TOKEN')
        self.smtp_server = os.getenv('SMTP_SERVER')
        self.smtp_port = int(os.getenv('SMTP_PORT'))
        self.smtp_username = os.getenv('SMTP_USERNAME')
        self.smtp_password = os.getenv('SMTP_PASSWORD')
        self.notification_email = os.getenv('NOTIFICATION_EMAIL')
        
        # Validate required environment variables
        required_vars = [
            'ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN',
            'SMTP_SERVER', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD',
            'NOTIFICATION_EMAIL'
        ]
        
        missing_vars = [var for var in required_vars if not os.getenv(var)]
        if missing_vars:
            raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

    def get_queue_tickets(self):
        """Fetch tickets from the queue and check for office down status"""
        url = f"https://{self.subdomain}.zendesk.com/api/v2/tickets.json"
        auth = (f"{self.email}/token", self.api_token)
        
        try:
            response = requests.get(url, auth=auth)
            response.raise_for_status()
            tickets = response.json()['tickets']
            
            # Count tickets and check for office down status
            ticket_count = len(tickets)
            office_down_tickets = [ticket for ticket in tickets 
                                 if ticket.get('custom_fields', {}).get('is_your_office_down') == True]
            
            return ticket_count, len(office_down_tickets) > 0
            
        except requests.exceptions.RequestException as e:
            print(f"Error fetching tickets: {e}")
            return 0, False

    def send_notification(self, subject, message):
        """Send email notification"""
        msg = MIMEMultipart()
        msg['From'] = self.smtp_username
        msg['To'] = self.notification_email
        msg['Subject'] = subject
        
        msg.attach(MIMEText(message, 'plain'))
        
        try:
            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(self.smtp_username, self.smtp_password)
            server.send_message(msg)
            server.quit()
            print("Notification email sent successfully")
        except Exception as e:
            print(f"Error sending email: {e}")

    def check_conditions(self):
        """Check queue conditions and send notifications if needed"""
        ticket_count, office_down = self.get_queue_tickets()
        
        if ticket_count >= 5:
            subject = "Zendesk Queue Alert: High Ticket Volume"
            message = f"Alert: The Zendesk queue currently has {ticket_count} tickets."
            self.send_notification(subject, message)
        
        if office_down:
            subject = "Zendesk Queue Alert: Office Down Ticket Detected"
            message = "Alert: A ticket with 'Is Your Office Down?' field checked has been detected."
            self.send_notification(subject, message)

def main():
    monitor = ZendeskMonitor()
    
    # Run the check immediately
    monitor.check_conditions()
    
    # Schedule checks every 5 minutes
    schedule.every(5).minutes.do(monitor.check_conditions)
    
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == "__main__":
    main() 