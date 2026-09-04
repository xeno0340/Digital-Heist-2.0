-- Digital Heist 2.0 -- Reference Console: landmark hints for Node 4.
--
-- seed_reference.sql originally shipped Node 4 with nothing here, on the
-- theory its riddles were "self-contained." In practice a team that
-- doesn't already know the underlying trivia (what a minaret is, who
-- Shah Jahan was, why Rome called a giant statue a "colossus") can get
-- stuck on general knowledge that has nothing to do with puzzle-solving
-- skill. These rows give that background WITHOUT ever stating the
-- landmark's actual name -- a team still has to make the final
-- connection themselves. Run this once in the Supabase SQL editor, in
-- addition to (not instead of) seed_reference.sql -- it's a separate
-- file specifically so you don't have to re-run and duplicate the rows
-- you already seeded.

insert into reference_facts (keywords, question, answer) values
  ('minaret, minarets, what is a minaret, four towers', 'What is a minaret?', 'A tall, slender tower - usually part of a mosque - historically used to call people to prayer.'),
  ('plague monument, built after a plague, king feared plague, monument thanks', 'Why did rulers sometimes build monuments after a plague?', 'A ruler would sometimes build a monument on the very spot they prayed for a plague to end, as a public thank-you once it did.'),
  ('mughal empire, mughal dynasty, mughal architecture', 'What was the Mughal Empire?', 'A dynasty that ruled large parts of the Indian subcontinent from the 16th to 19th century, famous for grand marble architecture.'),
  ('shah jahan, mumtaz mahal, king built tomb for queen', 'Who was Shah Jahan?', 'A 17th-century Mughal emperor who built a famous marble tomb after his wife died, out of grief.'),
  ('1889 worlds fair, paris exposition, worlds fair paris, built for a fair', 'What was the 1889 World''s Fair in Paris?', 'An exhibition marking the 100th anniversary of the French Revolution - its entrance arch was only meant to stand temporarily.'),
  ('great wall builders, chinese dynasties wall, northern frontier wall, defensive wall china', 'Why did ancient Chinese dynasties build long walls along their northern border?', 'To defend against invasions from nomadic groups to the north - several dynasties extended and connected older sections over centuries.'),
  ('colossus, what is a colossus, giant statue rome, name comes from a statue', 'What is a "colossus"?', 'A giant statue - ancient Rome once had an enormous bronze one standing near its most famous arena.'),
  ('roman amphitheater, gladiator combat venue, eighty thousand seats', 'What was a Roman amphitheater used for?', 'Large oval arenas built across the Roman Empire for gladiator fights and public spectacles.'),
  ('france gift united states, franco american friendship gift, torch and tablet gift', 'What did France gift the United States in the 1880s?', 'A large copper monument celebrating their alliance and shared ideal of liberty, shipped over in pieces and assembled on site.'),
  ('ellis island, immigrants arriving by ship new york, welcomed millions by sea', 'What was Ellis Island?', 'An immigration station in New York Harbor that processed millions of arrivals by ship in the late 19th and early 20th centuries.'),
  ('british royal visit india, king arriving by sea mumbai, gateway built for a visit', 'What historic event prompted a harbor-front monument to be built in Mumbai?', 'A British royal visit arriving by sea in the early 20th century - the monument was actually finished years after that visit happened.'),
  ('independence day flag ceremony delhi, prime minister flag ramparts, fort flag raised', 'What happens every year on India''s Independence Day at a historic fort in Delhi?', 'The Prime Minister raises the national flag from its ramparts and gives a speech - a tradition going back to 1947.');