import type { RoomFunction } from '../../core/model/types';

/** Gentle zone tints: public warm, private cool, wet blue-green, service neutral. */
export const ROOM_TINT: Record<RoomFunction, string> = {
  living: '#e9dcc6', dining: '#ebdcc1', family: '#e6dccb', foyer: '#e7e1d6', media: '#e6dccb', gym: '#dfe3d7',
  kitchen: '#e3dfcf', utility: '#dedcd6', store: '#dedcd6', parking: '#dddbd6',
  master_bedroom: '#d9dfe9', bedroom: '#dde2ea', study: '#dfe2e3', walkin: '#e2e0e8',
  bathroom: '#d6e5e5', powder: '#d6e5e5', pooja: '#efdcc9',
  stair: '#e1dfdb', corridor: '#e5e3df', balcony: '#dfe7d8', deck: '#e3dccd', other: '#e4e2de',
};

export const ROOM_LABEL: Record<RoomFunction, string> = {
  living: 'Living', dining: 'Dining', family: 'Family', foyer: 'Foyer', media: 'Media', gym: 'Gym', kitchen: 'Kitchen',
  utility: 'Utility', store: 'Store', parking: 'Parking', master_bedroom: 'Master bedroom', bedroom: 'Bedroom', study: 'Study',
  walkin: 'Walk-in', bathroom: 'Bathroom', powder: 'Powder', pooja: 'Pooja', stair: 'Stair', corridor: 'Corridor',
  balcony: 'Balcony', deck: 'Deck', other: 'Other',
};

export const ROOM_FUNCTIONS = Object.keys(ROOM_LABEL) as RoomFunction[];
