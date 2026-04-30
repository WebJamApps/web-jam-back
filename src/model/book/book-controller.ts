import { Request, Response } from 'express';
import { Icontroller } from '#src/lib/routeUtils.js';
import Controller from '#src/lib/controller.js';
import bookModel from './book-facade.js';

class BookController extends Controller {
  findCheckedOut(req: Request, res: Response) {
    return this.model.find({ checkedOutBy: req.params.id })
      .then((collection) => res.status(200).json(collection));
  }
}

export default new BookController(bookModel) as unknown as Icontroller;
