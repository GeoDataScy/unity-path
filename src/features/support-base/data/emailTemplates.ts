/**
 * E-mails Clickbank — 32 templates prontos, agrupados por situação.
 *
 * Conteúdo fixo no código de propósito: ao contrário dos produtos e das respostas
 * de SMS, estes templates não entram no admin da gestora (decisão de escopo da
 * primeira entrega). Para editar, mexer aqui e subir um deploy.
 */

export type EmailTemplate = {
  categoria: string;
  titulo: string;
  /** Plataforma a que o template se aplica (hoje todos são Clickbank). */
  tag: string;
  corpo: string;
};

/** Ordem em que as categorias aparecem na tela. */
export const EMAIL_TEMPLATE_CATEGORIES = [
  "Encerramento de Tickets",
  "Reembolso — Avisos e Confirmações",
  "Devolução e Logística",
  "Chargeback",
  "Follow Up",
  "Ofertas Especiais",
  "Nerve Ease — Casos Especiais",
  "Rastreio e Envio",
] as const;

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    categoria: "Encerramento de Tickets",
    titulo: "Encerramento de ticket",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nWe would like to inform you that we are closing this ticket for organizational purposes, as part of our ongoing efforts to improve our support workflow and continue assisting all customers in the most efficient way possible.\n\nPlease rest assured that, even with this ticket being closed, we remain fully available to assist you. If you have any questions or encounter any issues in the future, we will be more than happy to help.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Encerramento de Tickets",
    titulo: "Encerramento de ticket — já reembolsado",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nWe would like to inform you that we are closing this ticket for organizational purposes, as part of our ongoing efforts to improve our support workflow and continue assisting all customers in the most efficient way possible.\n\nWe would also like to confirm that your refund has been successfully processed. Please allow a few business days for the amount to appear in your account, depending on your bank or payment provider.\n\nPlease rest assured that, even with this ticket being closed, we remain fully available to assist you. If you have any questions or need support in the future, we will be more than happy to help.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Encerramento de Tickets",
    titulo: "Ticket encerrado — oficial",
    tag: "Clickbank",
    corpo: "Hello,\n\nSince we haven't received any further response, this ticket has been closed.\n\nIf you need further assistance in the future, please feel free to open a new ticket and we will be happy to help.\n\nThank you.\n\nSupport Team",
  },
  {
    categoria: "Encerramento de Tickets",
    titulo: "Aviso prévio de ticket fechado",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are well.\n\nWe are following up on your support request.\n\nIf we do not receive a response from you in the next few days, this ticket may be closed. However, if you still need help or have any questions, simply reply to this message and we will be happy to assist you.\n\nWe look forward to hearing from you.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Reembolso — Avisos e Confirmações",
    titulo: "Aviso de reembolso",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe are pleased to inform you that your refund has been successfully processed.\n\nWe would like to sincerely thank you for your patience, understanding, and cooperation throughout the entire process. It is greatly appreciated.\n\nShould you need any further assistance in the future, please do not hesitate to contact us. We will be more than happy to help you.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Reembolso — Avisos e Confirmações",
    titulo: "Reembolso integral — confirmação",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nFirst and foremost, we sincerely apologize for any confusion or inconvenience caused during this process. If at any point the experience felt difficult or frustrating, please know that this was never our intention.\n\nWe are committed to supporting our customers with care, attention, and respect, and to resolving each situation in the best possible way.\n\nWe would like to inform you that your full refund has been successfully processed. We are glad we were able to assist you in resolving this matter.\n\nPlease allow a few business days for the amount to be credited to your account, depending on your bank or payment provider.\n\nIf you need any further assistance, please do not hesitate to reach out. We will be more than happy to help.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Reembolso — Avisos e Confirmações",
    titulo: "Reembolso parcial (80%) — confirmação",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nFirst and foremost, we sincerely apologize for any confusion or inconvenience caused during this process. If at any point the experience felt difficult or frustrating, please know that this was never our intention. We are committed to supporting our customers with care, attention, and respect, and to assisting in resolving each situation in the best possible way.\n\nWe would like to inform you that a partial refund of 80% of your order value has been successfully processed. We are glad we were able to assist you and reach a suitable resolution for your case.\n\nPlease allow a few business days for the amount to be credited to your account, depending on your bank or payment provider.\n\nIf you need any further assistance, please do not hesitate to contact us. We will be more than happy to help.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Reembolso — Avisos e Confirmações",
    titulo: "Reembolso — resolução com demanda",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nFirst and foremost, we sincerely apologize for any confusion or inconvenience caused during this process. If at any point the experience felt frustrating or unclear, please know that this was never our intention. We always strive to support our customers with care, attention, and respect, and to provide the best possible assistance in every situation.\n\nAs a gesture of goodwill and to help resolve this matter in the best possible way, we have processed a full refund for you. Please allow a few business days for the amount to be credited to your account, depending on your bank or payment provider.\n\nIf you need any further assistance, please do not hesitate to contact us. We will be more than happy to help.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Reembolso — Avisos e Confirmações",
    titulo: "Reembolso upsell (80%)",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you again for your patience and understanding.\n\nAfter carefully reviewing your purchases and support history, we have found that you have already received a partial refund for another order.\n\nTo fully resolve this situation and ensure your experience is handled carefully and fairly, we will proceed with an additional 80% refund for the specific purchase associated with this ticket.\n\nThank you for your understanding and the opportunity to assist you, and we hope this solution contributes to the complete resolution of your case.\n\nPlease allow a few business days for the refund to be credited to your account, depending on your bank or payment provider.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Reembolso — Avisos e Confirmações",
    titulo: "Reembolso upsell (100%)",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you again for your patience and understanding.\n\nAfter carefully reviewing your purchases and support history, we have found that you have already received a full refund for another order.\n\nTo fully resolve this situation and ensure your experience is handled with care and fairness, we will proceed with an additional 100% refund for the specific purchase associated with this ticket.\n\nThank you for your understanding and the opportunity to assist you, and we hope this solution contributes to the complete resolution of your case.\n\nPlease allow a few business days for the refund to be credited to your account, depending on your bank or payment provider.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Devolução e Logística",
    titulo: "Solicitação de devolução",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope this message finds you well.\n\nFirst and foremost, we would like to thank you for your patience throughout this process. We truly appreciate your understanding and sincerely apologize for any inconvenience this situation may have caused.\n\nWe would like to inform you that we will proceed with your refund request. To move forward with the process, we kindly ask you to return the product to the address below:\n\nReturn Address:\nC/O Biofraga\n19655 E 35th Drive, Suite 100\nAurora, CO 80011\nUnited States\n\nOnce the package has been shipped, please kindly share the tracking number or any proof of shipment so we can monitor the return on our end.\n\nPlease note that, in accordance with our return policy, the return shipping costs are the responsibility of the customer. We appreciate your understanding in this matter.\n\nIf you have any questions or need further assistance, please do not hesitate to reach out. We remain at your disposal to support you throughout this process.\n\nThank you again for your cooperation and understanding.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Devolução e Logística",
    titulo: "Solicitação de devolução — padrão (80% ou 100%)",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for contacting us. We regret that the product did not meet your expectations.\n\nTo help resolve this situation in the most convenient way possible, we offer the following options:\n\nOption 1: We can process an 80% refund immediately, and you can keep the product. In this case, it will not be necessary to return it. This is the quickest and easiest option.\n\nOption 2: If you prefer, you can return the product to the address below, and we will process a full 100% refund:\n\nReturn Address:\nC/O Biofraga\n19655 E 35th Drive, Suite 100\nAurora, CO 80011\nUnited States\n\nIf you choose to return the product, please note that all return shipping costs are the customer's responsibility, in accordance with our return policy. Please also send us the tracking number or shipping confirmation as soon as the order is dispatched.\n\nWe sincerely apologize for any inconvenience caused and thank you for your patience and understanding.\n\nIf you need any further assistance, please do not hesitate to contact us at any time — we will be happy to help.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Devolução e Logística",
    titulo: "Produto a caminho — devolução (80% ou 100%)",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for contacting us. Unfortunately, the product has already been processed and cancellation is no longer possible.\n\nTo help resolve this situation in the most convenient way possible, we offer the following options:\n\nOption 1: We can process an 80% refund immediately and you can keep the product. In this case, it will not be necessary to return it. This is the quickest and easiest option.\n\nOption 2: If you prefer, you can refuse delivery of the product or return it to the address below and we will process a full 100% refund:\n\nReturn Address:\nC/O Biofraga\n19655 E 35th Drive, Suite 100\nAurora, CO 80011\nUnited States\n\nIf you choose to return the product, please note that all return shipping costs are the responsibility of the customer, according to our return policy. Please also send us the tracking number or shipping confirmation as soon as the order is dispatched.\n\nWe sincerely apologize for any inconvenience caused and thank you for your patience and understanding.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Devolução e Logística",
    titulo: "Cliente não quer mais o produto — com reembolso",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are well.\n\nWe understand that you no longer wish to receive the product and we sincerely apologize for any inconvenience caused.\n\nAs your order is already being processed, unfortunately it is no longer possible to cancel the shipment at this time. However, we would like to inform you that we will proceed with your refund request to help resolve this situation as smoothly as possible.\n\nPlease allow a few business days for the refund to be credited to your account, depending on your bank or payment provider.\n\nIf the package arrives at your address, please refuse delivery or return the product to the address below:\n\nReturn Address:\nC/O Biofraga\n19655 E 35th Drive, Suite 100\nAurora, CO 80011\nUnited States\n\nIf you return the package after delivery, please send us the tracking number or proof of shipment so we can properly track the return process.\n\nIf you need any further assistance, please do not hesitate to contact us. We will be happy to help.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Devolução e Logística",
    titulo: "Cliente não quer mais o produto — sem reembolso",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are well.\n\nWe fully understand your request and sincerely apologize for any inconvenience caused during this process.\n\nAs your order has already entered the shipping process, unfortunately it is no longer possible to stop or cancel the shipment at this stage. However, we will do our best to help you resolve this situation as smoothly as possible.\n\nIf the order arrives at your address, refuse delivery or return the product to the address below:\n\nReturn Address:\nC/O Biofraga\n19655 E 35th Drive, Suite 100\nAurora, CO 80011\nUnited States\n\nPlease note that return shipping costs are the customer's responsibility unless the return is related to a shipping error or damaged product.\n\nOnce the order is refused or returned, please send us the tracking number or proof of shipment so we can properly track the return process and proceed with the refund.\n\nThank you for your patience and understanding.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Devolução e Logística",
    titulo: "Follow up — oferta 80% ou 100%",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are well.\n\nWe would like to follow up on the options we offered previously and see which solution makes the most sense for you.\n\nOption 1: We can process an 80% refund immediately, and you can keep the product without needing to return it.\n\nOption 2: If you prefer, you can return the product to the address below to receive a full 100% refund after we receive and inspect the package:\n\nReturn Address:\nC/O Biofraga\n19655 E 35th Drive, Suite 100\nAurora, CO 80011\nUnited States\n\nPlease let us know which option you prefer, and we will be happy to assist you with the next steps.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Chargeback",
    titulo: "Mensagem de pedido de desculpas — chargeback",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe would like to sincerely apologize for any inconvenience or frustration you may have experienced during this situation.\n\nPlease know that we are committed to serving each customer with care, attention, and respect, and it is very important to us that every person feels heard, supported, and valued throughout their experience with our team.\n\nOur goal is always to provide the best possible support, not only through our products, but also through the way we care for our customers.\n\nOn behalf of our support team, we truly apologize for any stress, confusion, or inconvenience this situation may have caused.\n\nWe greatly value your feedback and experience, as it helps us continue improving our service.\n\nIf there is anything else we can assist you with, please do not hesitate to reach out. We will be more than happy to help.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Chargeback",
    titulo: "Chargeback — explicação do processo",
    tag: "Clickbank",
    corpo: "Hello,\n\nFirst and foremost, we sincerely apologize for any frustration or inconvenience this situation may have caused. Please know that our intention has always been to assist you in the best possible way and to properly address your concerns.\n\nAfter reviewing your case, we can confirm that a dispute/refund has already been opened with your bank or payment provider. Once a dispute is initiated, the transaction enters an external review process handled directly by the financial institution and the payment platform.\n\nUnfortunately, while the dispute is active, we are unable to manually process refunds, make changes to the transaction, or take further actions regarding the order, as the case is temporarily restricted during the investigation.\n\nAt this stage, the final resolution will be determined directly by your bank or payment provider, in accordance with their policies and review timelines.\n\nWe truly regret that the situation has reached this point and sincerely apologize for any inconvenience caused.\n\nIf you require any additional information or clarification from our side during the review process, please do not hesitate to contact us.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Chargeback",
    titulo: "Ticket encerrado — chargeback",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for your patience and understanding throughout this process.\n\nAt this stage, as the dispute/refund process is already being analyzed by your bank or payment provider, the final decision and resolution will be handled directly by their disputes department, according to their internal policies and deadlines.\n\nWe sincerely regret any inconvenience caused and would like to assure you that we are providing all possible assistance through our support team.\n\nShould your financial institution require any additional information during the analysis process, please do not hesitate to contact us at any time. We remain at your disposal and will be happy to assist whenever possible.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Follow Up",
    titulo: "Follow up estratégico",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nWe are following up on our previous message to check whether the proposed solution worked for you or if there is anything else we can assist you with.\n\nOur goal is always to resolve each situation in the most smooth and convenient way possible, and we remain fully available should you need any further support.\n\nWhen you have a moment, please feel free to reply to this message — we will be happy to continue assisting you with your case.\n\nThank you again for your patience and understanding throughout this process.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Follow Up",
    titulo: "Follow up breve",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are doing well.\n\nWe are following up as we have not yet received a response to our previous message. Please let us know if you still need any assistance or if there is anything else we can help you with.\n\nWe would be more than happy to continue supporting you with your case.\n\nKind regards,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Ofertas Especiais",
    titulo: "Oferta 80% — qualquer caso",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for contacting us. We fully understand your concerns and appreciate the opportunity to carefully review your case.\n\nOur goal is always to offer the best possible support to our customers, providing a fair and convenient solution.\n\nTo help resolve this issue quickly and efficiently, we would like to offer an 80% refund of your order value, without the need to return the products.\n\nWe believe this is the quickest and most convenient solution available and sincerely hope it contributes to a better experience with our company.\n\nPlease let us know if you wish to proceed with the process.\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Ofertas Especiais",
    titulo: "Clickbank — condição 80% imediato ou 100% com devolução",
    tag: "Clickbank",
    corpo: "Hello,\n\nI can release an 80% refund now with no return needed! Or, get a 100% refund if you return it (shipping at your cost). Which one works best for you?\n\nSincerely,\nSupport Team\n(Agente)",
  },
  {
    categoria: "Nerve Ease — Casos Especiais",
    titulo: "Nerve Ease — cliente não recebeu o produto",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for your patience and understanding. We are experiencing a temporary issue with our logistics/shipping partner regarding this specific product.\n\nWe sincerely apologize for the delay in your order. We assure you that your case has not been ignored and we are in constant contact with the shipping department to obtain updated information.\n\nWe fully understand how frustrating this situation can be, especially after waiting for your order, and we appreciate your patience while we resolve this issue. As soon as we receive new shipping or tracking information, we will share it with you immediately.\n\nIf you have any questions or concerns, please contact us. We are at your disposal and ready to help.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Nerve Ease — Casos Especiais",
    titulo: "Nerve Ease — casos secundários sem resposta",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for your patience and understanding. We are experiencing a temporary issue with our logistics/shipping partner regarding this specific product.\n\nWe sincerely apologize for the inconvenience and for not being able to assist you as much as we would like at this time. We assure you that your case has not been ignored and we are in constant contact with the shipping department to obtain updated information.\n\nWe fully understand how frustrating this situation can be, especially after waiting for your order, and we appreciate your patience while we resolve this issue. As soon as we receive new information, we will share it with you immediately.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Nerve Ease — Casos Especiais",
    titulo: "Nerve Ease — follow up logística",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are well.\n\nWe would like to thank you once again for your patience and understanding during this situation.\n\nWe are contacting you with a brief update on your order. The issue with our logistics/shipping partner is being resolved, and our team is actively monitoring your case to ensure everything proceeds as smoothly as possible.\n\nRest assured that your order remains a priority for us, and we are closely following all updates from the shipping department. As soon as new information is available, we will share it with you immediately.\n\nWe sincerely apologize for any inconvenience and frustration this delay may have caused.\n\nThank you again for your patience, trust, and understanding.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Nerve Ease — Casos Especiais",
    titulo: "Nerve Ease — caso extremo com reembolso integral",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe hope you are well.\n\nFirst of all, we sincerely apologize for any confusion, inconvenience, or frustration caused during this process. Please know that our intention has always been to support you in the best way possible, and we deeply regret that this situation did not meet your expectations.\n\nWe are currently experiencing a temporary issue with our logistics/shipping partner regarding this specific product. We understand how frustrating this can be, especially after waiting for your order, and we want to assure you that your case has not been ignored.\n\nAs a way to apologize for the inconvenience and to help resolve this issue in the smoothest and fairest way possible, we have processed a full refund for your order.\n\nPlease allow a few business days for the refund to be credited to your account, depending on your bank or payment provider.\n\nThank you for your patience, understanding, and the opportunity to assist you throughout this process.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Nerve Ease — Casos Especiais",
    titulo: "Nerve Ease — cliente quer produto (oferta 30%)",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for your patience and understanding during this situation.\n\nAs previously mentioned, we are experiencing a temporary issue with our logistics and shipping partner, which has affected some orders, including yours. We sincerely apologize for the inconvenience and delay.\n\nAs we greatly value your trust and would like to rectify the situation, we are offering a 30% refund of your purchase price as a gesture of goodwill for the delay. Furthermore, we will continue working with our shipping department to ensure your order is reshipped and delivered as quickly as possible.\n\nWe hope this solution demonstrates our commitment to your satisfaction, allowing you to receive the product you originally ordered.\n\nPlease let us know if you accept this offer. We will be happy to proceed immediately upon your confirmation.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Nerve Ease — Casos Especiais",
    titulo: "Nerve Ease — cliente quer cancelar (oferta 80%)",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for your patience and for sharing your concerns with us.\n\nWe fully understand your frustration with the delay. Unfortunately, we are experiencing a temporary issue with our logistics and shipping partner, which has affected the delivery of some orders.\n\nTo resolve this situation as quickly and conveniently as possible, we would like to offer an 80% refund of your purchase price, without the need to return the product.\n\nIf your order arrives, you can keep the product as a courtesy. You will not need to return it. We understand this situation has been disappointing, and this offer aims to compensate you for the inconvenience.\n\nPlease let us know if you wish to accept this offer, and we will be happy to proceed.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Rastreio e Envio",
    titulo: "Etiqueta criada",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe would like to provide you with an update on your order.\n\nYour shipment has been processed and a shipping label has already been created with the carrier. The package is awaiting the next movement update from the transport network.\n\nCarrier: UniUni\nTracking number: [número de rastreio]\n\nAt this time, the tracking status shows \"Label created,\" which means the shipment has been registered and is entering the carrier's system. Further tracking updates and the estimated delivery date will be available once the package arrives at UniUni's distribution centers.\n\nIf you have any questions, please contact us. We will continue to monitor your shipment and will be happy to assist you whenever necessary.\n\nSincerely,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Rastreio e Envio",
    titulo: "DHL — a caminho",
    tag: "Clickbank",
    corpo: "Hello,\n\nWe would like to provide you with an update on your order.\n\nAccording to the latest tracking information, your package is in transit and on its way to the delivery address. The carrier has confirmed that the shipment is moving through their logistics network toward its final destination.\n\nTo keep you informed, we have arranged for tracking notifications to be sent directly to your email. This will allow you to monitor the package's progress and receive updates as soon as they become available.\n\nIf you have any questions or need further assistance, please feel free to contact us.\n\nBest regards,\nSupport Team – Nerve Ease\n(Agente)",
  },
  {
    categoria: "Rastreio e Envio",
    titulo: "Solicitação de mudança de e-mail",
    tag: "Clickbank",
    corpo: "Hello,\n\nThank you for contacting us.\n\nWe would like to clarify that your order remains active and will continue to be delivered normally to the delivery address associated with the purchase.\n\nPlease note that updating your email address is not necessary for the shipping process itself, as delivery is directly linked to the order and the shipping information already registered.\n\nAt the moment, we cannot modify the email address associated with the transaction through our system. However, this will not prevent you from receiving your order.\n\nIf you need help with tracking updates or order status, please contact us at any time — we will be happy to assist you.\n\nSincerely,\nSupport Team\n(Agente)",
  },
];
