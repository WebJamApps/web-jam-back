import { Request, Response } from 'express';
import Controller from '../../lib/controller';
import bookModel from './book-facade';
import { Icontroller } from '../../lib/routeUtils';

class BookController extends Controller {
  findCheckedOut(req: Request, res: Response) {
    return this.model.find({ checkedOutBy: req.params.id })
      .then((collection: string) => res.status(200).json(collection));
  }
}

export default new BookController(bookModel) as unknown as Icontroller;
