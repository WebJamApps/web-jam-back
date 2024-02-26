import { Request, Response } from 'express';
import { Icontroller } from 'src/lib/routeUtils';
import Controller from 'src/lib/controller';
import bookModel from './book-facade';

class BookController extends Controller {
  findCheckedOut(req: Request, res: Response) {
    return this.model.find({ checkedOutBy: req.params.id })
      .then((collection: string) => res.status(200).json(collection));
  }
}

export default new BookController(bookModel) as unknown as Icontroller;
