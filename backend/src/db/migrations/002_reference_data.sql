-- Reference data (not demo data): initial categories and platform settings.
INSERT INTO categories (slug, name_en, name_ta, name_hi, sort_order) VALUES
 ('sparklers',        'Sparklers',        'கம்பி மத்தாப்பு',      'फुलझड़ी',        1),
 ('flower-pots',      'Flower Pots',      'பூந்தொட்டி',            'अनार (फ्लावर पॉट)', 2),
 ('ground-chakkars',  'Ground Chakkars',  'தரைச் சக்கரம்',         'भू-चक्र',        3),
 ('wheels',           'Wheels',           'சக்கரம்',               'चक्री',          4),
 ('rockets',          'Rockets',          'ராக்கெட்',              'रॉकेट',          5),
 ('fountains',        'Fountains',        'ஃபவுண்டன்',            'फव्वारा',        6),
 ('twinkling-stars',  'Twinkling Stars',  'ட்விங்கிளிங் ஸ்டார்',   'ट्विंकलिंग स्टार', 7),
 ('colour-matches',   'Colour Matches',   'கலர் தீப்பெட்டி',       'रंगीन माचिस',    8),
 ('gift-boxes',       'Gift Boxes',       'பரிசுப் பெட்டி',        'गिफ्ट बॉक्स',    9),
 ('combo-boxes',      'Combo Boxes',      'காம்போ பெட்டி',         'कॉम्बो बॉक्स',   10),
 ('family-packs',     'Family Packs',     'குடும்ப பேக்',          'फैमिली पैक',     11);

INSERT INTO settings (key, value) VALUES
 ('commission_bps',      '500'),                 -- 5%
 ('subscription_amount', '19900'),               -- ₹199 in paise
 ('subscription_months', '6'),
 ('allowed_cities',      '["Sivakasi"]'),
 ('min_age',             '18'),
 ('first_admin_done',    'false');
