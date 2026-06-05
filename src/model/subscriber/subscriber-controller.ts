import { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import { sendMail } from '#src/lib/mailer.js';
import subscriberModel from './subscriber-facade.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s.@]+$/;
const STATUS_OPTIONS = ['pending', 'active', 'unsubscribed'];

interface SubscriberDoc {
  _id: string;
  name: string;
  email: string;
  status: string;
  unsubscribeToken?: string;
}

interface OptInBody {
  name?: string;
  email?: string;
  phone?: number;
  status?: string;
  channels?: { email?: boolean; sms?: boolean };
}

// Backend's own public base URL, for the confirm/unsubscribe links emailed to
// fans. Derived from the request so no extra Heroku env is needed; forces https
// in production (behind the Heroku proxy req.protocol can read as http).
function selfBaseUrl(req: Request): string {
  const proto = process.env.NODE_ENV === 'production' ? /* istanbul ignore next */ 'https' : req.protocol;
  return `${proto}://${req.get('host') ?? ''}`;
}

// Minimal branded HTML page returned when a fan clicks an email link, so it
// works without the SPA.
function page(title: string, body = ''): string {
  const bodyStyle = 'font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;text-align:center;color:#222';
  const para = body ? `<p style="color:#555">${body}</p>` : '';
  const link = '<a href="https://www.joshandmariamusic.com" style="color:#1565c0">joshandmariamusic.com</a>';
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${title}</title></head><body style="${bodyStyle}">`
    + `<h1 style="font-size:1.5rem">${title}</h1>${para}`
    + `<p style="margin-top:2rem">${link}</p>`
    + '</body></html>';
}

function readToken(req: Request): string {
  return typeof req.query.token === 'string' ? req.query.token : '';
}

class SubscriberController extends Controller {
  resErr(res: Response, e: Error) { // eslint-disable-line class-methods-use-this
    return res.status(500).json({ message: e.message });
  }

  // PUBLIC — fan opt-in from the website form. Creates/refreshes a `pending`
  // record and emails a confirmation link (double opt-in). Already-active
  // emails are a friendly no-op; previously-unsubscribed emails re-enter as
  // pending.
  async optIn(req: Request, res: Response): Promise<unknown> {
    const body = (req.body || {}) as OptInBody;
    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    if (!name) return res.status(400).json({ message: 'Name is required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'A valid email is required' });

    let existing: SubscriberDoc | null;
    try { existing = await this.model.findOne({ email }) as unknown as SubscriberDoc | null; } catch (e) { return this.resErr(res, e as Error); }
    if (existing && existing.status === 'active') {
      return res.status(200).json({ message: 'You are already subscribed' });
    }

    const confirmToken = crypto.randomUUID();
    const channels = { email: body.channels?.email !== false, sms: false };
    try {
      if (existing) {
        await this.model.findByIdAndUpdate(existing._id, {
          name, status: 'pending', confirmToken, channels,
        });
      } else {
        await this.model.create({
          name, email, channels, status: 'pending', confirmToken, unsubscribeToken: crypto.randomUUID(),
        });
      }
    } catch (e) { return this.resErr(res, e as Error); }

    const link = `${selfBaseUrl(req)}/subscriber/confirm?token=${confirmToken}`;
    const html = `<p>Hi ${name},</p>`
      + '<p>Please confirm you would like gig updates from Josh &amp; Maria Music:</p>'
      + `<p><a href="${link}">Confirm my subscription</a></p>`
      + '<p>If you did not request this, just ignore this email.</p>';
    await sendMail({ to: email, subject: 'Confirm your Josh & Maria Music subscription', html });
    return res.status(200).json({ message: 'Almost there — check your email to confirm your subscription' });
  }

  // PUBLIC — double opt-in confirmation link target. pending -> active.
  async confirm(req: Request, res: Response): Promise<unknown> {
    const token = readToken(req);
    if (!token) return res.status(400).send(page('Invalid confirmation link'));
    let doc: SubscriberDoc | null;
    try {
      doc = await this.model.findOne({ confirmToken: token }) as unknown as SubscriberDoc | null;
    } catch (e) { return this.resErr(res, e as Error); }
    if (!doc) return res.status(404).send(page('This confirmation link is no longer valid'));
    try { await this.model.findByIdAndUpdate(doc._id, { status: 'active', confirmToken: '' }); } catch (e) { return this.resErr(res, e as Error); }
    return res.status(200).send(page("You're subscribed!", 'Thanks for joining — we will let you know about upcoming gigs.'));
  }

  // PUBLIC — unsubscribe link target embedded in every send. -> unsubscribed.
  async unsubscribe(req: Request, res: Response): Promise<unknown> {
    const token = readToken(req);
    if (!token) return res.status(400).send(page('Invalid unsubscribe link'));
    let doc: SubscriberDoc | null;
    try {
      doc = await this.model.findOne({ unsubscribeToken: token }) as unknown as SubscriberDoc | null;
    } catch (e) { return this.resErr(res, e as Error); }
    if (!doc) return res.status(404).send(page('This unsubscribe link is no longer valid'));
    try { await this.model.findByIdAndUpdate(doc._id, { status: 'unsubscribed' }); } catch (e) { return this.resErr(res, e as Error); }
    return res.status(200).send(page("You've been unsubscribed", 'You will not receive any more gig emails from us. Sorry to see you go!'));
  }

  // ADMIN — manually add a subscriber (defaults to active/trusted; mints an
  // unsubscribe token so admin-added people can still opt out).
  async create(req: Request, res: Response): Promise<unknown> {
    const body = (req.body || {}) as OptInBody & { _id?: string };
    delete body._id;
    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    if (!name) return res.status(400).json({ message: 'Name is required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'A valid email is required' });
    if (body.status && STATUS_OPTIONS.indexOf(body.status) === -1) return res.status(400).json({ message: 'status not valid' });
    let doc;
    try {
      doc = await this.model.create({
        name,
        email,
        phone: body.phone,
        channels: { email: body.channels?.email !== false, sms: !!body.channels?.sms },
        status: body.status || 'active',
        unsubscribeToken: crypto.randomUUID(),
      });
    } catch (e) { return this.resErr(res, e as Error); }
    return res.status(201).json(doc);
  }

  // ADMIN — edit a subscriber (status / channels / name / email).
  findByIdAndUpdate(req: Request<{ id: string }>, res: Response): Response<unknown> | Promise<unknown> {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Update id is invalid' });
    }
    const body = (req.body || {}) as OptInBody;
    if (body.status && STATUS_OPTIONS.indexOf(body.status) === -1) return res.status(400).json({ message: 'status not valid' });
    if (body.name === '') return res.status(400).json({ message: 'Name is required' });
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'A valid email is required' });
      req.body.email = email;
    }
    return this.contFBIandU(req, res);
  }
}

export default new SubscriberController(subscriberModel) as unknown as Icontroller;
