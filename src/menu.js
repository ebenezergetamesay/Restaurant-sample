// The supplied menu photos are included under public/menu/.
// Because glare/reflections obscure several Amharic names, the demo uses a small
// editable starter catalogue. Replace these names/prices with the verified menu.
export const categories = ['Popular', 'Main Dishes', 'Pasta', 'Drinks', 'Student Specials'];

export const menu = [
  { id:'m1', name:'Normal Firfir', amharic:'ኖርማል ፍርፍር', price:240, category:'Main Dishes', description:'A traditional firfir plate prepared fresh.', badge:'Popular' },
  { id:'m2', name:'Half Tibs Firfir', amharic:'ግማሽ ጥብስ ፍርፍር', price:140, category:'Main Dishes', description:'Firfir served with a tibs-style topping.', badge:'' },
  { id:'m3', name:'Pasta with Egg', amharic:'ፓስታ በእንቁላል', price:170, category:'Pasta', description:'Pasta with egg.', badge:'' },
  { id:'m4', name:'Pasta with Vegetables', amharic:'ፓስታ በአትክልት', price:170, category:'Pasta', description:'Pasta prepared with vegetables.', badge:'Vegetarian' },
  { id:'m5', name:'Pasta with Sauce', amharic:'ፓስታ በስጎ', price:100, category:'Pasta', description:'Pasta with house sauce.', badge:'' },
  { id:'m6', name:'Shiro', amharic:'ሽሮ', price:170, category:'Main Dishes', description:'Classic shiro served fresh.', badge:'Popular' },
  { id:'m7', name:'Tomato', amharic:'ቲማቲም', price:130, category:'Main Dishes', description:'Fresh tomato side/order.', badge:'' },
  { id:'m8', name:'Student Pasta Special', amharic:'ፓስታ በአትክልት / በስጎ', price:150, category:'Student Specials', description:'Contract-student special. Confirm the exact selection with the restaurant.', badge:'Student' },
  { id:'m9', name:'Student Shiro Special', amharic:'ሽሮ', price:150, category:'Student Specials', description:'Contract-student special.', badge:'Student' },
  { id:'m10', name:'Student Firfir Special', amharic:'ግማሽ ፍርፍር', price:130, category:'Student Specials', description:'Contract-student special.', badge:'Student' },
  { id:'m11', name:'Soft Drink', amharic:'ለስላሳ', price:150, category:'Drinks', description:'Select your preferred available soft drink at pickup.', badge:'' },
  { id:'m12', name:'Water', amharic:'ውሃ', price:30, category:'Drinks', description:'Bottled water.', badge:'' }
];
