// Shared validation for the local server and the static file-picker workflow.
(() => {
  function createObservation(catalog, payload) {
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 5000) throw new Error('Scrivi un’osservazione di massimo 5000 caratteri.');
    const card=catalog.cards.find(card=>card.id===payload.cardId);
    if (!card) throw new Error('Carta non presente nel catalogo.');
    const setId=payload.setId || card.setId;
    if (!(card.setIds || [card.setId]).includes(setId)) throw new Error('Espansione non associata alla carta.');
    const product=card.productVersions?.find(product=>product.setId===setId);
    const images=card.imageVersions || [{language:card.imageLanguage,image:card.image}];
    const image=images.find(image=>image.language===payload.language && (!product || product.languages.includes(image.language)));
    if (!image) throw new Error('Lingua non disponibile per questa versione.');
    const id=payload.id || crypto.randomUUID();
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new Error('Identificatore della segnalazione non valido.');
    return {id,createdAt:new Date().toISOString(),status:'open',cardId:card.id,game:card.game,code:card.code,name:card.name,setId,variantLabel:card.variantLabel || 'Standard',language:image.language,image:image.image.slice(image.image.indexOf('cards/')),text:payload.text.trim().replace(/\r\n/g,'\n')};
  }
  function appendObservation(registry, entry) {
    if (!registry || !registry.cards || Array.isArray(registry.cards) || !registry.sets) throw new Error('Seleziona il file CARD_REVIEW.json del progetto.');
    if (!registry.cards[entry.cardId]) throw new Error('Il registro selezionato non contiene questa carta.');
    const section=registry.userObservations ||= {schemaVersion:1,description:'Osservazioni inserite dall’utente nel popup, separate dalle verifiche automatiche.',entries:[]};
    if (section.schemaVersion!==1 || !Array.isArray(section.entries)) throw new Error('Formato delle osservazioni non riconosciuto.');
    const existing=section.entries.find(note=>note.id===entry.id);
    if (existing) {
      if (existing.cardId!==entry.cardId || existing.setId!==entry.setId || existing.language!==entry.language || existing.text!==entry.text) throw new Error('Identificatore già usato per un’altra osservazione.');
      return existing;
    }
    section.entries.push(entry);
    return entry;
  }
  globalThis.TCG_REVIEW_NOTES=Object.freeze({createObservation,appendObservation});
})();
