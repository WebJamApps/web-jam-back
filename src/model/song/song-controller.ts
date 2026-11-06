import Controller from '../../lib/controller.js';
import songModel from './song-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';
import type { Request, Response } from 'express';
import { publicSong } from './public-song.js';

class SongController extends Controller {
  override async find(req: Request, res: Response): Promise<unknown> {
    try {
      // Public filters may only name public fields; private rights must not be
      // discoverable by probing query results even though they are not returned.
      const allowed = new Set(['title', 'artist', 'composer', 'category', 'album', 'year', 'url', 'orderBy', '_id']);
      const filter = Object.fromEntries(Object.entries(req.query).filter(([key, value]) => allowed.has(key) && typeof value === 'string'));
      const songs = await this.model.find(filter);
      return res.status(200).json(songs.map(publicSong));
    } catch {
      return res.status(500).json({ message: 'Unable to read songs' });
    }
  }
}

export default new SongController(songModel) as unknown as Icontroller;
