import { IsIn } from 'class-validator';
import { CATALOG } from '../wallet.constants';

export class ItemDto {
  @IsIn(CATALOG.map((item) => item.id))
  itemId: string;
}
