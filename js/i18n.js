/* Tiny i18n module. 5 languages (en/ru/de/it/da). Persists to localStorage,
   dispatches `i18n:changed` CustomEvent on `document` when language changes. */

export const LANGS = ['en', 'ru', 'de', 'it', 'da'];
export const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'arg_map_lang';

const _I18N_DATA = {
  app_title: [
    'INSIDE ARG // Investigation Map',
    'INSIDE ARG // Карта расследования',
    'INSIDE ARG // Untersuchungskarte',
    'INSIDE ARG // Mappa di indagine',
    'INSIDE ARG // Efterforskningskort',
  ],
  app_logo: ['ARG//MAP', 'ARG//КАРТА', 'ARG//KARTE', 'ARG//MAPPA', 'ARG//KORT'],
  toolbar_search_placeholder: [
    'search hotspots...',
    'поиск точек...',
    'Hotspots suchen...',
    'cerca hotspot...',
    'søg hotspots...',
  ],
  filter_all: ['All', 'Все', 'Alle', 'Tutti', 'Alle'],
  filter_solved: ['Solved', 'Решено', 'Gelöst', 'Risolto', 'Løst'],
  filter_partial: ['Partial', 'Частично', 'Teilweise', 'Parziale', 'Delvist'],
  filter_unsolved: ['Unsolved', 'Не решено', 'Ungelöst', 'Irrisolto', 'Uløst'],
  filter_no_data: ['No Data', 'Нет данных', 'Keine Daten', 'Nessun dato', 'Ingen data'],
  mode_viewer: ['Viewer', 'Просмотр', 'Ansicht', 'Visualizza', 'Visning'],
  mode_editor: ['Editor', 'Редактор', 'Editor', 'Editor', 'Editor'],
  export_button: ['Export', 'Экспорт', 'Export', 'Esporta', 'Eksporter'],
  import_button: ['Import', 'Импорт', 'Import', 'Importa', 'Importer'],
  reset_defaults_button: ['Reset', 'Сброс', 'Zurücksetzen', 'Ripristina', 'Nulstil'],
  side_panel_close: ['Close', 'Закрыть', 'Schließen', 'Chiudi', 'Luk'],
  side_panel_edit_md: ['Edit raw MD', 'Править MD', 'MD bearbeiten', 'Modifica MD', 'Rediger MD'],
  side_panel_save: ['Save', 'Сохранить', 'Speichern', 'Salva', 'Gem'],
  side_panel_export_md: ['Export MD', 'Экспорт MD', 'MD exportieren', 'Esporta MD', 'Eksporter MD'],
  editor_new_hotspot: ['Add hotspot', 'Добавить точку', 'Hotspot hinzufügen', 'Aggiungi hotspot', 'Tilføj hotspot'],
  editor_edit_hotspot: ['Edit hotspot', 'Править точку', 'Hotspot bearbeiten', 'Modifica hotspot', 'Rediger hotspot'],
  editor_title_label: ['Title *', 'Заголовок *', 'Titel *', 'Titolo *', 'Titel *'],
  editor_title_placeholder: [
    'e.g. Printer Easter Egg',
    'напр. Пасхалка с принтером',
    'z.B. Drucker-Easter-Egg',
    'es. Easter Egg stampante',
    'fx. Printer-easter-egg',
  ],
  editor_slug_label: ['Slug', 'Slug', 'Slug', 'Slug', 'Slug'],
  editor_slug_placeholder: [
    'auto-from-title',
    'авто из заголовка',
    'auto aus Titel',
    'auto dal titolo',
    'auto fra titel',
  ],
  editor_status_label: ['Status', 'Статус', 'Status', 'Stato', 'Status'],
  editor_tags_label: [
    'Tags (comma-separated)',
    'Теги (через запятую)',
    'Tags (kommagetrennt)',
    'Tag (separati da virgola)',
    'Tags (komma-separeret)',
  ],
  editor_tags_placeholder: [
    'e.g. stickers, iam8bit',
    'напр. stickers, iam8bit',
    'z.B. stickers, iam8bit',
    'es. stickers, iam8bit',
    'fx. stickers, iam8bit',
  ],
  editor_content_label: [
    'Initial markdown content',
    'Начальное содержимое markdown',
    'Anfängliche Markdown-Inhalte',
    'Contenuto markdown iniziale',
    'Indledende markdown-indhold',
  ],
  editor_content_hint: [
    'Will be cached under the slug. Use the side panel\'s "Edit raw MD" later to refine.',
    'Будет закэшировано по slug. Позже редактируйте через «Править MD» в боковой панели.',
    'Wird unter dem Slug zwischengespeichert. Später über „MD bearbeiten" im Seitenpanel anpassen.',
    'Verrà memorizzato sotto lo slug. Affina poi tramite "Modifica MD" nel pannello laterale.',
    'Caches under sluggen. Forfin senere via "Rediger MD" i sidepanelet.',
  ],
  editor_save_button: ['Save', 'Сохранить', 'Speichern', 'Salva', 'Gem'],
  editor_cancel_button: ['Cancel', 'Отмена', 'Abbrechen', 'Annulla', 'Annuller'],
  editor_delete_button: ['Delete', 'Удалить', 'Löschen', 'Elimina', 'Slet'],
  editor_md_overlay_title: [
    'Edit Markdown',
    'Редактирование Markdown',
    'Markdown bearbeiten',
    'Modifica Markdown',
    'Rediger Markdown',
  ],
  editor_md_apply: ['Apply', 'Применить', 'Anwenden', 'Applica', 'Anvend'],
  editor_discard_title: [
    'Unsaved changes',
    'Несохранённые изменения',
    'Ungespeicherte Änderungen',
    'Modifiche non salvate',
    'Ikke gemte ændringer',
  ],
  editor_discard_confirm_q: [
    'You have unsaved edits in this hotspot. Save them, discard, or keep editing?',
    'В этой точке есть несохранённые правки. Сохранить, отбросить или продолжить редактирование?',
    'Sie haben ungespeicherte Änderungen in diesem Hotspot. Speichern, verwerfen oder weiter bearbeiten?',
    'Hai modifiche non salvate in questo hotspot. Salvare, scartare o continuare a modificare?',
    'Du har ikke-gemte ændringer i dette hotspot. Gem, kassér eller fortsæt redigering?',
  ],
  editor_discard_keep: [
    'Keep editing',
    'Продолжить',
    'Weiter bearbeiten',
    'Continua',
    'Fortsæt',
  ],
  editor_discard_discard: ['Discard', 'Отбросить', 'Verwerfen', 'Scarta', 'Kassér'],
  editor_discard_save: ['Save', 'Сохранить', 'Speichern', 'Salva', 'Gem'],
  editor_delete_title: ['Delete hotspot?', 'Удалить точку?', 'Hotspot löschen?', 'Eliminare hotspot?', 'Slet hotspot?'],
  editor_delete_confirm: [
    'This removes the hotspot. The markdown content is kept under its slug so re-creating with the same slug reattaches it.',
    'Точка будет удалена. Содержимое markdown остаётся в кэше по её slug, и пересоздание с тем же slug подключит его обратно.',
    'Der Hotspot wird entfernt. Der Markdown-Inhalt bleibt unter dem Slug erhalten; bei erneuter Erstellung mit demselben Slug wird er wieder verknüpft.',
    'Rimuove l\'hotspot. Il contenuto markdown resta sotto il suo slug; ricreandolo con lo stesso slug torna collegato.',
    'Fjerner hotspottet. Markdown-indholdet bevares under dets slug, så hvis du opretter et nyt med samme slug, kobles det på igen.',
  ],
  reset_title: [
    'Reset to bundled defaults?',
    'Сбросить к стандартным?',
    'Auf Standard zurücksetzen?',
    'Ripristinare i predefiniti?',
    'Nulstil til standard?',
  ],
  reset_message: [
    'This wipes your local-storage state and reloads the bundled hotspots + markdown.',
    'Стирает локальное состояние и перезагружает встроенные точки и markdown.',
    'Löscht den localStorage-Zustand und lädt die mitgelieferten Hotspots + Markdown neu.',
    'Cancella lo stato in localStorage e ricarica hotspot e markdown predefiniti.',
    'Sletter localStorage-tilstanden og indlæser de medfølgende hotspots + markdown.',
  ],
  reset_confirm: ['Reset', 'Сбросить', 'Zurücksetzen', 'Ripristina', 'Nulstil'],
  status_solved: ['Solved', 'Решено', 'Gelöst', 'Risolto', 'Løst'],
  status_partial: ['Partial', 'Частично', 'Teilweise', 'Parziale', 'Delvist'],
  status_unsolved: ['Unsolved', 'Не решено', 'Ungelöst', 'Irrisolto', 'Uløst'],
  status_nodata: ['No Data', 'Нет данных', 'Keine Daten', 'Nessun dato', 'Ingen data'],
  toast_loaded_local: [
    'Loaded local-storage state',
    'Загружено из локального хранилища',
    'localStorage-Zustand geladen',
    'Stato localStorage caricato',
    'Indlæste localStorage-tilstand',
  ],
  toast_exported: [
    'Exported arg_map_state.json',
    'Экспортировано arg_map_state.json',
    'arg_map_state.json exportiert',
    'arg_map_state.json esportato',
    'Eksporterede arg_map_state.json',
  ],
  toast_imported: [
    'Imported {n} hotspots',
    'Импортировано точек: {n}',
    '{n} Hotspots importiert',
    'Importati {n} hotspot',
    'Importerede {n} hotspots',
  ],
  toast_import_failed: [
    'Import failed: {error}',
    'Импорт не удался: {error}',
    'Import fehlgeschlagen: {error}',
    'Importazione fallita: {error}',
    'Import mislykkedes: {error}',
  ],
  toast_md_saved: [
    'Saved markdown to local storage',
    'Markdown сохранён в локальное хранилище',
    'Markdown im localStorage gespeichert',
    'Markdown salvato in localStorage',
    'Gemte markdown i localStorage',
  ],
  toast_md_downloaded: [
    'Downloaded {filename}',
    'Скачано: {filename}',
    'Heruntergeladen: {filename}',
    'Scaricato: {filename}',
    'Hentede {filename}',
  ],
  toast_hotspot_added: [
    'Hotspot added',
    'Точка добавлена',
    'Hotspot hinzugefügt',
    'Hotspot aggiunto',
    'Hotspot tilføjet',
  ],
  toast_hotspot_updated: [
    'Hotspot updated',
    'Точка обновлена',
    'Hotspot aktualisiert',
    'Hotspot aggiornato',
    'Hotspot opdateret',
  ],
  toast_hotspot_deleted: [
    'Hotspot deleted',
    'Точка удалена',
    'Hotspot gelöscht',
    'Hotspot eliminato',
    'Hotspot slettet',
  ],
  toast_init_failed: [
    'Init failed: {error}',
    'Сбой инициализации: {error}',
    'Initialisierung fehlgeschlagen: {error}',
    'Inizializzazione fallita: {error}',
    'Init mislykkedes: {error}',
  ],
  side_panel_loading: ['Loading...', 'Загрузка...', 'Lade...', 'Caricamento...', 'Indlæser...'],
  search_no_matches: ['No matches.', 'Совпадений нет.', 'Keine Treffer.', 'Nessuna corrispondenza.', 'Ingen resultater.'],
  context_edit_hotspot: ['Edit hotspot', 'Править точку', 'Hotspot bearbeiten', 'Modifica hotspot', 'Rediger hotspot'],
  context_delete_hotspot: [
    'Delete hotspot',
    'Удалить точку',
    'Hotspot löschen',
    'Elimina hotspot',
    'Slet hotspot',
  ],
  context_delete_confirm_msg: [
    'Remove "{title}"? Its markdown text stays cached so re-adding with the same slug restores it.',
    'Удалить «{title}»? Markdown останется в кэше, добавление с тем же slug восстановит его.',
    '„{title}" entfernen? Der Markdown-Text bleibt im Cache, sodass eine erneute Erstellung mit dem gleichen Slug ihn wiederherstellt.',
    'Rimuovere "{title}"? Il testo markdown resta in cache; ricreandolo con lo stesso slug viene ripristinato.',
    'Fjern "{title}"? Markdown-teksten bevares i cachen, så genoprettelse med samme slug genskaber den.',
  ],
  arrows_layer_label: ['Arrows', 'Стрелки', 'Pfeile', 'Frecce', 'Pile'],
  arrow_kind_orthogonal: ['Orthogonal', 'Ортогональная', 'Orthogonal', 'Ortogonale', 'Ortogonal'],
  arrow_kind_manhattan: ['Manhattan', 'Манхэттен', 'Manhattan', 'Manhattan', 'Manhattan'],
  arrow_kind_bezier: ['Bezier', 'Безье', 'Bézier', 'Bezier', 'Bezier'],
  arrow_kind_straight: ['Straight', 'Прямая', 'Gerade', 'Diritta', 'Lige'],
  arrow_style_solid: ['Solid', 'Сплошная', 'Durchgezogen', 'Continua', 'Fuldt optrukket'],
  arrow_style_dashed: ['Dashed', 'Пунктир', 'Gestrichelt', 'Tratteggiata', 'Stiplet'],
  arrow_style_dotted: ['Dotted', 'Точечная', 'Gepunktet', 'Puntinata', 'Prikket'],
  arrow_colour_accent: ['Accent', 'Акцент', 'Akzent', 'Accento', 'Accent'],
  arrow_colour_solved: ['Solved', 'Решено', 'Gelöst', 'Risolto', 'Løst'],
  arrow_colour_partial: ['Partial', 'Частично', 'Teilweise', 'Parziale', 'Delvist'],
  arrow_colour_unsolved: ['Unsolved', 'Не решено', 'Ungelöst', 'Irrisolto', 'Uløst'],
  arrow_colour_muted: ['Muted', 'Приглушённая', 'Gedämpft', 'Attenuata', 'Dæmpet'],
  arrow_delete_confirm: [
    'Delete this arrow?',
    'Удалить эту стрелку?',
    'Diesen Pfeil löschen?',
    'Eliminare questa freccia?',
    'Slet denne pil?',
  ],
  arrow_label_placeholder: [
    'arrow label',
    'подпись стрелки',
    'Pfeilbeschriftung',
    'etichetta freccia',
    'pile-etiket',
  ],
  arrow_props_kind: ['Kind', 'Тип', 'Art', 'Tipo', 'Type'],
  arrow_props_label: ['Label', 'Подпись', 'Beschriftung', 'Etichetta', 'Etiket'],
  arrow_props_style: ['Style', 'Стиль', 'Stil', 'Stile', 'Stil'],
  arrow_props_colour: ['Colour', 'Цвет', 'Farbe', 'Colore', 'Farve'],
  arrow_props_delete: ['Delete', 'Удалить', 'Löschen', 'Elimina', 'Slet'],
  arrow_context_delete: ['Delete arrow', 'Удалить стрелку', 'Pfeil löschen', 'Elimina freccia', 'Slet pil'],
  arrow_context_edit_label: [
    'Edit label',
    'Изменить подпись',
    'Beschriftung bearbeiten',
    'Modifica etichetta',
    'Rediger etiket',
  ],
  lang_label: ['Language', 'Язык', 'Sprache', 'Lingua', 'Sprog'],
  mod_dragging_disabled_hint: [
    'Drag inside editor mode to draw',
    'Перетаскивайте в режиме редактора, чтобы рисовать',
    'Im Editor-Modus ziehen, um zu zeichnen',
    'Trascina in modalità editor per disegnare',
    'Træk i editor-tilstand for at tegne',
  ],
  zoom_in: ['Zoom in', 'Приблизить', 'Vergrößern', 'Ingrandisci', 'Zoom ind'],
  zoom_out: ['Zoom out', 'Отдалить', 'Verkleinern', 'Riduci', 'Zoom ud'],
  zoom_fit: ['Fit to screen', 'По размеру экрана', 'An Bildschirm anpassen', 'Adatta a schermo', 'Tilpas til skærm'],
};

const I18N = Object.fromEntries(
  LANGS.map((lang, idx) => [
    lang,
    Object.fromEntries(Object.entries(_I18N_DATA).map(([k, vals]) => [k, vals[idx]])),
  ]),
);

let currentLang = DEFAULT_LANG;

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return false;
  if (lang === currentLang) return false;
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    void e;
  }
  document.documentElement.setAttribute('lang', lang);
  document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  return true;
}

export function initLang() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    void e;
  }
  const lang = LANGS.includes(stored) ? stored : DEFAULT_LANG;
  currentLang = lang;
  document.documentElement.setAttribute('lang', lang);
  return lang;
}

export function tr(key, params) {
  const dict = I18N[currentLang] || I18N[DEFAULT_LANG];
  let s = dict[key];
  if (s === undefined) {
    const fallback = I18N[DEFAULT_LANG][key];
    if (fallback === undefined) return key;
    s = fallback;
  }
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

export function keysCount() {
  return Object.keys(_I18N_DATA).length;
}

export function getDict(lang) {
  return I18N[lang] || I18N[DEFAULT_LANG];
}
