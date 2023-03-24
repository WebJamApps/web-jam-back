import Debug from 'debug';
import nodemailer from 'nodemailer';

const debug = Debug('web-jam-back:InquiryController');

// This is your API key that you retrieve from www.mailgun.com/cp (free up to 10K monthly emails)
// const emailAuth = {
//   auth: {
//     api_key: 'key-1234123412341234',
//     domain: 'one of your domain names listed at your https://app.mailgun.com/app/sending/domains',
//   },
// };

// const nodemailerMailgun = nodemailer.createTransport(mg(emailAuth));
class InquiryController {
  // sgMail: any;

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor() {
    // this.sgMail = sgMail;
  }

  // eslint-disable-next-line @typescript-eslint/require-await, class-methods-use-this
  async sendInquiryEmail(bodyhtml: any, toemail: any, subjectline: any, res: any) {
    if (process.env.NODE_ENV !== 'test') {
      try {
        // await nodemailerMailgun.sendMail({
        //   from: 'inquiry@web-jam.com',
        //   to: toemail, // An array if you have multiple recipients.
        //   cc: 'joshua.v.sherman@gmail.com',
        //   // bcc: 'secretagent@company.gov',
        //   subject: subjectline,
        //   replyTo: 'joshua.v.sherman@gmail.com',
        //   html: bodyhtml, // You can use "html:" to send HTML email content. It's magic!
        // });
        res.status(200).json({ message: 'email sent' });
      } catch (err) {
        res.status(500).json({ message: 'email sending error', error: `${(err as Error).message}` });
      }
    }
    // this.sgMail.setApiKey(process.env.SENDGRID_API_KEY || /* istanbul ignore next */'');
    // const msg = {
    //   to: toemail,
    //   from: 'user-service@web-jam.com',
    //   subject: subjectline,
    //   text: bodyhtml,
    //   html: bodyhtml,
    // };
    /* istanbul ignore if */
    // if (process.env.NODE_ENV !== 'test') {
    //   // await sgMail.send(msg);
    // }
  }

  handleInquiry(req: any, res: any) { // eslint-disable-line class-methods-use-this
    debug(req.body);
    return this.sendInquiryEmail(JSON.stringify(req.body), 'web.jam.adm@gmail.com', 'inquiry', res);
  }
}
export default InquiryController;
