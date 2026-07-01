import { Request, Response } from 'express';
import { Icontroller } from '#src/lib/routeUtils.js';
import ArtistController from '#src/lib/artist-controller.js';
import bookModel from './book-facade.js';

// The `book` collection is shared across artists/tenants (#885): JaMmusic
// slideshow photos, per-artist bio/page-content docs, and CollegeLutheran's
// library. Artist scoping is backward compatible — legacy field-less records
// (all of CollegeLutheran's) read as the default artist.
class BookController extends ArtistController {
  findCheckedOut(req: Request, res: Response) {
    return this.model.find({ checkedOutBy: req.params.id })
      .then((collection) => res.status(200).json(collection));
  }
}

export default new BookController(bookModel) as unknown as Icontroller;
