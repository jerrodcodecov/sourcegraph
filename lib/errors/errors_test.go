package errors

import (
	"fmt"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
)

// Enforce some invariants with our error libraries.

func TestMultiError(t *testing.T) {
	errFoo := New("foo")
	errBar := New("bar")
	formattingDirectives := []string{"", "%s", "%v", "%+v"}
	tests := []struct {
		name string
		err  error
		// Make sure all our ways of combining errors actually print them.
		wantStrings []string
		// Make sure all our ways of combining errors retains our ability to assert
		// against them.
		wantIs []error
	}{
		{
			name:        "Append",
			err:         Append(errFoo, errBar),
			wantStrings: []string{"foo", "bar"},
			wantIs:      []error{errFoo, errBar},
		},
		{
			name:        "CombineErrors",
			err:         CombineErrors(errFoo, errBar),
			wantStrings: []string{"foo", "bar"},
			wantIs:      []error{errFoo, errBar},
		},
		{
			name:        "Wrap(Append)",
			err:         Wrap(Append(errFoo, errBar), "hello world"),
			wantStrings: []string{"hello world", "foo", "bar"},
			wantIs:      []error{errFoo, errBar},
		},
		{
			name:        "Wrap(Wrap(Append))",
			err:         Wrap(Wrap(Append(errFoo, errBar), "hello world"), "deep!"),
			wantStrings: []string{"deep", "hello world", "foo", "bar"},
			wantIs:      []error{errFoo, errBar},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, directive := range formattingDirectives {
				var str string
				if directive == "" {
					str = tt.err.Error()
				} else {
					str = fmt.Sprintf(directive, tt.err)
				}
				for _, contains := range tt.wantStrings {
					assert.Contains(t, str, contains)
				}
			}
			for _, isErr := range tt.wantIs {
				assert.ErrorIs(t, tt.err, isErr)
			}
		})
	}
	for fn, str := range map[string]string{} {
		t.Run(fn, func(t *testing.T) {
			t.Log(str)
			assert.Contains(t, str, "foo", fn)
			assert.Contains(t, str, "bar", fn)
		})
	}
}

func TestCombineNil(t *testing.T) {
	assert.Nil(t, Append(nil, nil))
	assert.Nil(t, CombineErrors(nil, nil))
}

func TestCombineSingle(t *testing.T) {
	errFoo := New("foo")

	assert.ErrorIs(t, Append(errFoo, nil), errFoo)
	assert.ErrorIs(t, CombineErrors(errFoo, nil), errFoo)
	assert.ErrorIs(t, Append(nil, errFoo), errFoo)
	assert.ErrorIs(t, CombineErrors(nil, errFoo), errFoo)
}

// TestRepeatedCombine tests the most common patterns of instantiate + append
func TestRepeatedCombine(t *testing.T) {
	t.Run("mixed append with typed nil", func(t *testing.T) {
		var errs MultiError
		for i := 1; i < 10; i++ {
			if i%2 == 0 {
				errs = Append(errs, New(strconv.Itoa(i)))
			} else {
				errs = Append(errs, nil)
			}
		}
		assert.NotNil(t, errs)
		assert.Equal(t, 4, len(errs.Errors()))
		assert.Equal(t, `4 errors occurred:
	* 2
	* 4
	* 6
	* 8`, errs.Error())
	})
	t.Run("mixed append with untyped nil", func(t *testing.T) {
		var errs error
		for i := 1; i < 10; i++ {
			if i%2 == 0 {
				errs = Append(errs, New(strconv.Itoa(i)))
			} else {
				errs = Append(errs, nil)
			}
		}
		assert.NotNil(t, errs)
		assert.Equal(t, `4 errors occurred:
	* 2
	* 4
	* 6
	* 8`, errs.Error())
		// try casting
		var multi MultiError
		assert.True(t, As(errs, &multi))
		assert.Equal(t, 4, len(multi.Errors()))
	})
	t.Run("all nil append with typed nil", func(t *testing.T) {
		var errs MultiError
		for i := 1; i < 10; i++ {
			errs = Append(errs, nil)
		}
		assert.Nil(t, errs)
	})
	t.Run("all nil append with untyped nil", func(t *testing.T) {
		var errs error
		for i := 1; i < 10; i++ {
			errs = Append(errs, nil)
		}
		assert.Nil(t, errs)
		// try casting
		var multi MultiError
		assert.False(t, As(errs, &multi))
	})
}
