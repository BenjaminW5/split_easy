import type { ReceiptDetail } from "../api/receipts";
import { formatCents } from "../utils/money";

/**
 * The read-only view of the dishes extracted from a receipt. ReceiptsPage
 * shows it by default; the receipt-editing module (stories #12-#17) can be
 * passed to ReceiptsPage as `renderItems` instead and receives the same
 * ReceiptDetail, so nothing is entered twice.
 */
export function ReceiptItemsTable({ receipt }: { receipt: ReceiptDetail }) {
  if (receipt.items.length === 0) return null;
  return (
    <table>
      <caption>Dishes</caption>
      <thead>
        <tr>
          <th scope="col">Dish</th>
          <th scope="col">Qty</th>
          <th scope="col">Unit price</th>
          <th scope="col">Price</th>
        </tr>
      </thead>
      <tbody>
        {receipt.items.map((item) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.quantity}</td>
            <td>{formatCents(item.unit_price_cents)}</td>
            <td>{formatCents(item.total_cents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={3}>
            Dishes total
          </th>
          <td>{formatCents(receipt.items_total_cents)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
