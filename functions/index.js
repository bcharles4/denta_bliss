const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');

admin.initializeApp();

// Get email credentials from environment variables
const gmailEmail = process.env.GMAIL_EMAIL || 'mitracharles04@gmail.com';
const gmailPassword = process.env.GMAIL_PASSWORD || 'kkjopcqhukwtmuro';

// Get Semaphore SMS API configuration
const semaphoreApiKey = process.env.SEMAPHORE_API_KEY || '173c145eb2b7ed71c0f7e91fbfda9619';
const semaphoreSenderName = process.env.SEMAPHORE_SENDER_NAME || 'DentalBliss';

console.log('Config loaded:', { 
  email: gmailEmail ? 'Set' : 'Not set', 
  password: gmailPassword ? 'Set' : 'Not set',
  semaphoreKey: semaphoreApiKey ? 'Set' : 'Not set'
});

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: gmailEmail,
    pass: gmailPassword
  }
});

// Configure Semaphore SMS API
const semaphoreConfig = {
  baseURL: 'https://api.semaphore.co/api/v4',
  headers: {
    'Content-Type': 'application/json'
  },
  params: {
    apikey: semaphoreApiKey
  }
};


async function sendSMS(phoneNumber, message) {
  try {
    showToast('Sending SMS...', 'info');
    
    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    if (!validatePhoneNumber(formattedPhone)) {
      throw new Error('Invalid phone number format. Must be at least 10 digits.');
    }
    
    console.log('Sending SMS via Cloud Function:', formattedPhone);
    
    // Call your existing Cloud Function
    const response = await fetch('https://us-central1-dentabliss.cloudfunctions.net/sendAppointmentSMS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: formattedPhone,
        message: message
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast('SMS sent successfully!');
      return { success: true, data: result };
    } else {
      throw new Error(result.error || 'Failed to send SMS');
    }
  } catch (error) {
    console.error('Error sending SMS:', error);
    showToast(`SMS failed: ${error.message}`, 'error');
    
    // Fallback: Show manual instructions
    const manualInstructions = `
    SMS SENDING INSTRUCTIONS:
    
    1. Open Semaphore API Console: https://semaphore.co/api
    2. Use these parameters:
       - API Key: ${SEMAPHORE_API_KEY}
       - Number: ${phoneNumber}
       - Message: ${message.substring(0, 100)}...
       - Sender Name: ${SEMAPHORE_SENDER_NAME}
    
    3. OR use curl command:
    curl -X POST https://api.semaphore.co/api/v4/messages \\
      -H "Content-Type: application/json" \\
      -d '{
        "apikey": "${SEMAPHORE_API_KEY}",
        "number": "${phoneNumber}",
        "message": "${message.replace(/"/g, '\\"')}",
        "sendername": "${SEMAPHORE_SENDER_NAME}"
      }'
    `;
    
    console.log('Manual SMS instructions:\n', manualInstructions);
    
    return { 
      success: false, 
      error: error.message,
      manualInstructions: manualInstructions 
    };
  }
}

// Helper function to validate phone number
function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber) return false;
  
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  // Basic validation for Philippine numbers
  return cleanPhone.length >= 10 && cleanPhone.length <= 12;
}

// Create CORS middleware with proper configuration
const corsHandler = cors({ origin: true });

// Send appointment reminder function (with SMS)
exports.sendAppointmentReminder = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      // Set CORS headers
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Handle preflight OPTIONS request
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      
      // Handle POST method only
      if (req.method !== 'POST') {
        return res.status(405).json({
          success: false,
          error: 'Method not allowed'
        });
      }
      
      const { appointmentId, sendSMS: shouldSendSMS = false } = req.body;
      
      if (!appointmentId) {
        return res.status(400).json({
          success: false,
          error: 'appointmentId is required'
        });
      }
      
      // Get appointment data from Firestore
      const appointmentDoc = await admin.firestore()
        .collection('appointments')
        .doc(appointmentId)
        .get();
      
      if (!appointmentDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }
      
      const appointment = appointmentDoc.data();
      const updateData = {};
      const results = {
        email: { success: false },
        sms: { success: false }
      };
      
      // Send Email
      if (appointment.patientEmail) {
        try {
          // Create email content
          const mailOptions = {
            from: `"DentaBliss Clinic" <${gmailEmail}>`,
            to: appointment.patientEmail,
            subject: `Dental Appointment Reminder - ${appointment.date}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #3a86ff;">Appointment Reminder</h2>
                <p>Dear ${appointment.patientName || 'Patient'},</p>
                
                <div style="background: #f6f8fb; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h3>Appointment Details:</h3>
                  <p><strong>Date:</strong> ${appointment.date}</p>
                  <p><strong>Time:</strong> ${appointment.time}</p>
                  <p><strong>Service:</strong> ${appointment.service || 'Dental Checkup'}</p>
                  <p><strong>Dentist:</strong> Dr. ${appointment.dentist || 'TBA'}</p>
                  ${appointment.notes ? `<p><strong>Notes:</strong> ${appointment.notes}</p>` : ''}
                </div>
                
                <p>Please arrive 10 minutes before your scheduled time.</p>
                <p>If you need to reschedule, please call us at (02) 8888-9999.</p>
                
                <hr style="border: 1px solid #e6e9ef; margin: 20px 0;">
                
                <p style="color: #6b7280; font-size: 12px;">
                  DentaBliss Dental Clinic<br>
                  123 Dental Street, Manila, Philippines<br>
                  Phone: (02) 8888-9999<br>
                  Email: contact@dentabliss.com
                </p>
              </div>
            `
          };
          
          // Send email
          const info = await transporter.sendMail(mailOptions);
          console.log('Email sent:', info.messageId, 'to:', appointment.patientEmail);
          
          updateData.emailSent = admin.firestore.FieldValue.serverTimestamp();
          updateData.emailStatus = 'sent';
          updateData.emailMessageId = info.messageId;
          
          results.email = {
            success: true,
            messageId: info.messageId,
            to: appointment.patientEmail
          };
        } catch (error) {
          console.error('Error sending email:', error);
          updateData.emailStatus = 'failed';
          updateData.emailError = error.message;
          
          results.email = {
            success: false,
            error: error.message
          };
        }
      } else {
        console.log('No email address for appointment:', appointmentId);
      }
      
      // Send SMS (if requested and phone number exists)
      if (shouldSendSMS && appointment.patientPhone) {
        if (validatePhoneNumber(appointment.patientPhone)) {
          try {
            const smsMessage = `DentaBliss Appointment Reminder\n\n` +
                             `Dear ${appointment.patientName || 'Patient'},\n\n` +
                             `Your appointment is scheduled for:\n` +
                             `Date: ${appointment.date}\n` +
                             `Time: ${appointment.time}\n` +
                             `Service: ${appointment.service || 'Dental Checkup'}\n` +
                             `Dentist: Dr. ${appointment.dentist || 'TBA'}\n\n` +
                             `Please arrive 10 mins early.\n` +
                             `To reschedule: (02) 8888-9999`;
            
            const smsResult = await sendSMS(appointment.patientPhone, smsMessage);
            
            if (smsResult.success) {
              updateData.smsSent = admin.firestore.FieldValue.serverTimestamp();
              updateData.smsStatus = 'sent';
              updateData.smsMessageId = smsResult.messageId;
              
              results.sms = {
                success: true,
                messageId: smsResult.messageId,
                to: appointment.patientPhone
              };
            } else {
              updateData.smsStatus = 'failed';
              updateData.smsError = smsResult.error;
              
              results.sms = {
                success: false,
                error: smsResult.error
              };
            }
          } catch (error) {
            console.error('Error in SMS sending:', error);
            updateData.smsStatus = 'failed';
            updateData.smsError = error.message;
            
            results.sms = {
              success: false,
              error: error.message
            };
          }
        } else {
          console.log('Invalid phone number format:', appointment.patientPhone);
          results.sms = {
            success: false,
            error: 'Invalid phone number format'
          };
        }
      }
      
      // Update appointment with results
      if (Object.keys(updateData).length > 0) {
        await admin.firestore()
          .collection('appointments')
          .doc(appointmentId)
          .update(updateData);
      }
      
      return res.status(200).json({
        success: true,
        message: 'Reminder sent',
        results: results
      });
    } catch (error) {
      console.error('Error sending reminder:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// New function: Send SMS only
exports.sendAppointmentSMS = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      // Set CORS headers
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Handle preflight OPTIONS request
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      
      // Handle POST method only
      if (req.method !== 'POST') {
        return res.status(405).json({
          success: false,
          error: 'Method not allowed'
        });
      }
      
      const { appointmentId } = req.body;
      
      if (!appointmentId) {
        return res.status(400).json({
          success: false,
          error: 'appointmentId is required'
        });
      }
      
      // Get appointment data from Firestore
      const appointmentDoc = await admin.firestore()
        .collection('appointments')
        .doc(appointmentId)
        .get();
      
      if (!appointmentDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }
      
      const appointment = appointmentDoc.data();
      
      if (!appointment.patientPhone) {
        return res.status(400).json({
          success: false,
          error: 'Patient phone number not found'
        });
      }
      
      if (!validatePhoneNumber(appointment.patientPhone)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid phone number format'
        });
      }
      
      // Create SMS message
      const smsMessage = `DentaBliss Appointment Confirmation\n\n` +
                       `Dear ${appointment.patientName || 'Patient'},\n\n` +
                       `Your appointment details:\n` +
                       `Date: ${appointment.date}\n` +
                       `Time: ${appointment.time}\n` +
                       `Service: ${appointment.service || 'Dental Checkup'}\n` +
                       `Dentist: Dr. ${appointment.dentist || 'TBA'}\n\n` +
                       `Please arrive 10 mins early.\n` +
                       `For inquiries: (02) 8888-9999`;
      
      // Send SMS
      const smsResult = await sendSMS(appointment.patientPhone, smsMessage);
      
      // Update appointment
      const updateData = {
        smsSent: admin.firestore.FieldValue.serverTimestamp(),
        smsStatus: smsResult.success ? 'sent' : 'failed'
      };
      
      if (smsResult.success) {
        updateData.smsMessageId = smsResult.messageId;
      } else {
        updateData.smsError = smsResult.error;
      }
      
      await admin.firestore()
        .collection('appointments')
        .doc(appointmentId)
        .update(updateData);
      
      return res.status(200).json({
        success: smsResult.success,
        message: smsResult.success ? 'SMS sent successfully' : 'Failed to send SMS',
        messageId: smsResult.messageId,
        to: appointment.patientPhone,
        error: smsResult.error
      });
    } catch (error) {
      console.error('Error sending SMS:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// Send tomorrow reminders (with SMS)
exports.sendTomorrowReminders = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      // Set CORS headers
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Handle preflight OPTIONS request
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      
      // Handle GET and POST methods
      if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({
          success: false,
          error: 'Method not allowed'
        });
      }
      
      // Get tomorrow's date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      
      console.log('Looking for appointments on:', tomorrowStr);
      
      // Get tomorrow's appointments
      const appointmentsSnapshot = await admin.firestore()
        .collection('appointments')
        .where('date', '==', tomorrowStr)
        .where('status', 'in', ['Confirmed', 'Pending'])
        .get();
      
      console.log('Found', appointmentsSnapshot.size, 'appointments for tomorrow');
      
      const results = [];
      
      for (const doc of appointmentsSnapshot.docs) {
        const appointment = { id: doc.id, ...doc.data() };
        const updateData = {};
        const result = {
          appointmentId: appointment.id,
          patientName: appointment.patientName,
          email: { success: false },
          sms: { success: false }
        };
        
        // Send Email
        if (appointment.patientEmail) {
          try {
            // Create email content
            const mailOptions = {
              from: `"DentaBliss Clinic" <${gmailEmail}>`,
              to: appointment.patientEmail,
              subject: `Dental Appointment Reminder - Tomorrow ${appointment.date}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #3a86ff;">Tomorrow's Appointment Reminder</h2>
                  <p>Dear ${appointment.patientName || 'Patient'},</p>
                  
                  <div style="background: #fff7ed; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
                    <h3>REMINDER: Your appointment is TOMORROW</h3>
                    <p><strong>Date:</strong> ${appointment.date} (Tomorrow)</p>
                    <p><strong>Time:</strong> ${appointment.time}</p>
                    <p><strong>Service:</strong> ${appointment.service || 'Dental Checkup'}</p>
                    <p><strong>Dentist:</strong> Dr. ${appointment.dentist || 'TBA'}</p>
                  </div>
                  
                  <p><strong>⚠️ Please arrive 10 minutes before your scheduled time.</strong></p>
                  <p>If you need to reschedule, please call us immediately at (02) 8888-9999.</p>
                  
                  <hr style="border: 1px solid #e6e9ef; margin: 20px 0;">
                  
                  <p style="color: #6b7280; font-size: 12px;">
                    DentaBliss Dental Clinic<br>
                    123 Dental Street, Manila, Philippines<br>
                    Phone: (02) 8888-9999
                  </p>
                </div>
              `
            };
            
            // Send email
            const info = await transporter.sendMail(mailOptions);
            console.log('Tomorrow reminder email sent:', info.messageId);
            
            updateData.emailSent = admin.firestore.FieldValue.serverTimestamp();
            updateData.emailStatus = 'sent';
            updateData.emailMessageId = info.messageId;
            
            result.email = {
              success: true,
              messageId: info.messageId,
              to: appointment.patientEmail
            };
          } catch (error) {
            console.error('Failed to send email to', appointment.patientEmail, ':', error.message);
            updateData.emailStatus = 'failed';
            updateData.emailError = error.message;
            
            result.email = {
              success: false,
              error: error.message
            };
          }
        }
        
        // Send SMS
        if (appointment.patientPhone && validatePhoneNumber(appointment.patientPhone)) {
          try {
            const smsMessage = `DENTABLISS URGENT REMINDER\n\n` +
                             `Dear ${appointment.patientName || 'Patient'},\n\n` +
                             `Your dental appointment is TOMORROW:\n` +
                             `Date: ${appointment.date}\n` +
                             `Time: ${appointment.time}\n` +
                             `Service: ${appointment.service || 'Dental Checkup'}\n` +
                             `Dentist: Dr. ${appointment.dentist || 'TBA'}\n\n` +
                             `⚠️ Please arrive 10 mins early.\n` +
                             `To reschedule call NOW: (02) 8888-9999`;
            
            const smsResult = await sendSMS(appointment.patientPhone, smsMessage);
            
            if (smsResult.success) {
              updateData.smsSent = admin.firestore.FieldValue.serverTimestamp();
              updateData.smsStatus = 'sent';
              updateData.smsMessageId = smsResult.messageId;
              
              result.sms = {
                success: true,
                messageId: smsResult.messageId,
                to: appointment.patientPhone
              };
            } else {
              updateData.smsStatus = 'failed';
              updateData.smsError = smsResult.error;
              
              result.sms = {
                success: false,
                error: smsResult.error
              };
            }
          } catch (error) {
            console.error('Failed to send SMS to', appointment.patientPhone, ':', error.message);
            updateData.smsStatus = 'failed';
            updateData.smsError = error.message;
            
            result.sms = {
              success: false,
              error: error.message
            };
          }
        }
        
        // Update appointment
        if (Object.keys(updateData).length > 0) {
          await admin.firestore()
            .collection('appointments')
            .doc(appointment.id)
            .update(updateData);
        }
        
        results.push(result);
      }
      
      // Calculate summary
      const total = results.length;
      const emailsSent = results.filter(r => r.email.success).length;
      const smsSent = results.filter(r => r.sms.success).length;
      
      return res.status(200).json({
        success: true,
        summary: {
          total: total,
          emailsSent: emailsSent,
          smsSent: smsSent,
          totalReminders: emailsSent + smsSent
        },
        results: results
      });
    } catch (error) {
      console.error('Error sending tomorrow reminders:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// New function: Bulk SMS for multiple appointments
exports.sendBulkSMS = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      // Set CORS headers
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Handle preflight OPTIONS request
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      
      // Handle POST method only
      if (req.method !== 'POST') {
        return res.status(405).json({
          success: false,
          error: 'Method not allowed'
        });
      }
      
      const { appointmentIds, message } = req.body;
      
      if (!appointmentIds || !Array.isArray(appointmentIds) || appointmentIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'appointmentIds array is required'
        });
      }
      
      if (!message || message.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'Message is required'
        });
      }
      
      const results = [];
      
      for (const appointmentId of appointmentIds) {
        try {
          // Get appointment data
          const appointmentDoc = await admin.firestore()
            .collection('appointments')
            .doc(appointmentId)
            .get();
          
          if (!appointmentDoc.exists) {
            results.push({
              appointmentId,
              success: false,
              error: 'Appointment not found'
            });
            continue;
          }
          
          const appointment = appointmentDoc.data();
          
          if (!appointment.patientPhone || !validatePhoneNumber(appointment.patientPhone)) {
            results.push({
              appointmentId,
              success: false,
              error: 'Invalid or missing phone number'
            });
            continue;
          }
          
          // Personalize message
          const personalizedMessage = message
            .replace('{patientName}', appointment.patientName || 'Patient')
            .replace('{date}', appointment.date || '')
            .replace('{time}', appointment.time || '')
            .replace('{service}', appointment.service || 'Dental Checkup')
            .replace('{dentist}', appointment.dentist || 'TBA');
          
          // Send SMS
          const smsResult = await sendSMS(appointment.patientPhone, personalizedMessage);
          
          // Update appointment
          const updateData = {
            bulkSmsSent: admin.firestore.FieldValue.serverTimestamp(),
            bulkSmsStatus: smsResult.success ? 'sent' : 'failed'
          };
          
          if (smsResult.success) {
            updateData.bulkSmsMessageId = smsResult.messageId;
          } else {
            updateData.bulkSmsError = smsResult.error;
          }
          
          await admin.firestore()
            .collection('appointments')
            .doc(appointmentId)
            .update(updateData);
          
          results.push({
            appointmentId,
            success: smsResult.success,
            messageId: smsResult.messageId,
            to: appointment.patientPhone,
            error: smsResult.error
          });
        } catch (error) {
          console.error(`Error processing appointment ${appointmentId}:`, error);
          results.push({
            appointmentId,
            success: false,
            error: error.message
          });
        }
      }
      
      return res.status(200).json({
        success: true,
        total: results.length,
        sent: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results
      });
    } catch (error) {
      console.error('Error in bulk SMS:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});